const crypto = require('node:crypto');
const dataAccess = require('./dataAccess');

const MAX_RECIPIENTS = 10000;
const RESEND_BATCH_SIZE = 100;
const SUBJECT_MAX_LENGTH = 150;
const BODY_MAX_LENGTH = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function validateAnnouncement(subject, body) {
  const normalizedSubject = String(subject || '').trim();
  const normalizedBody = String(body || '').trim();
  if (!normalizedSubject || normalizedSubject.length > SUBJECT_MAX_LENGTH) {
    throw new Error(`SUBJECT_LENGTH_INVALID:${SUBJECT_MAX_LENGTH}`);
  }
  if (!normalizedBody || normalizedBody.length > BODY_MAX_LENGTH) {
    throw new Error(`BODY_LENGTH_INVALID:${BODY_MAX_LENGTH}`);
  }
  return { subject: normalizedSubject, body: normalizedBody };
}

function normalizeRecipients(users = []) {
  const byEmail = new Map();
  for (const user of Array.isArray(users) ? users : []) {
    const email = String(user.email || '').trim().toLowerCase();
    const userId = String(user.id || user._id || '').trim();
    if (!userId || !EMAIL_PATTERN.test(email) || byEmail.has(email)) continue;
    byEmail.set(email, { userId, email });
  }
  return [...byEmail.values()];
}

function getUnsubscribeSecret() {
  return String(process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || '').trim();
}

function createUnsubscribeToken(userId) {
  const secret = getUnsubscribeSecret();
  if (!secret) throw new Error('EMAIL_UNSUBSCRIBE_SECRET_NOT_CONFIGURED');
  const encodedId = Buffer.from(String(userId)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedId).digest('base64url');
  return `${encodedId}.${signature}`;
}

function verifyUnsubscribeToken(token) {
  const [encodedId, suppliedSignature, extra] = String(token || '').split('.');
  const secret = getUnsubscribeSecret();
  if (!secret || !encodedId || !suppliedSignature || extra) return null;
  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedId).digest();
  let actualSignature;
  try { actualSignature = Buffer.from(suppliedSignature, 'base64url'); }
  catch { return null; }
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) return null;
  let userId;
  try { userId = Buffer.from(encodedId, 'base64url').toString('utf8'); }
  catch { return null; }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ? userId : null;
}

function buildUnsubscribeUrl(userId) {
  const base = String(process.env.APP_URL || 'https://operix.website').trim().replace(/\/+$/, '');
  const url = new URL('/email-unsubscribe.html', base);
  url.searchParams.set('token', createUnsubscribeToken(userId));
  return url.toString();
}

function buildAnnouncementEmail({ subject, body, unsubscribeUrl, oneClickUnsubscribeUrl = unsubscribeUrl }) {
  const paragraphs = String(body || '').trim().split(/\n{2,}/).map(paragraph =>
    `<p style="margin:0 0 14px;line-height:1.9;color:#cbd5e1">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
  ).join('');
  const safeSubject = escapeHtml(subject);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl);
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubject}</title></head><body style="margin:0;background:#060d18;color:#e2e8f0;font-family:Tahoma,Arial,sans-serif"><main style="box-sizing:border-box;max-width:640px;margin:24px auto;padding:28px;background:#0d1726;border:1px solid #26364b;border-radius:18px"><div style="color:#f5c96d;font-size:13px;font-weight:700;letter-spacing:1px">OPERIX · تحديث رسمي</div><h1 style="margin:18px 0;font-size:24px;line-height:1.5;color:#f8fafc">${safeSubject}</h1>${paragraphs}<hr style="margin:24px 0;border:0;border-top:1px solid #26364b"><footer style="font-size:11px;line-height:1.8;color:#8190a3">أُرسلت هذه الرسالة إلى بريد موثّق مرتبط بحساب OPERIX لتقديم تحديثات المنصة. <a href="${safeUnsubscribeUrl}" style="color:#f5c96d">إلغاء الاشتراك من رسائل التحديثات</a>.</footer></main></body></html>`;
  const text = `${subject}\n\n${body}\n\nإلغاء الاشتراك من رسائل التحديثات: ${unsubscribeUrl}`;
  return { html, text, headers: {
    'List-Unsubscribe': `<${oneClickUnsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  } };
}

async function getEligibleRecipients() {
  if (!dataAccess.isSupabaseRuntime()) throw new Error('SUPABASE_RUNTIME_REQUIRED');
  const users = await dataAccess.user.findEmailBroadcastRecipients(MAX_RECIPIENTS + 1);
  if (users.length > MAX_RECIPIENTS) throw new Error(`RECIPIENT_LIMIT_EXCEEDED:${MAX_RECIPIENTS}`);
  return normalizeRecipients(users);
}

function safeProviderError(error) {
  return String(error?.message || error || 'EMAIL_PROVIDER_ERROR').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

async function updateCampaignTotals(campaignId) {
  const [queuedCount, sendingCount, sentCount, failedCount, suppressedCount, unknownCount] = await Promise.all([
    dataAccess.emailBroadcastRecipient.countDocuments({ campaignId, status: 'queued' }),
    dataAccess.emailBroadcastRecipient.countDocuments({ campaignId, status: 'sending' }),
    dataAccess.emailBroadcastRecipient.countDocuments({ campaignId, status: 'sent' }),
    dataAccess.emailBroadcastRecipient.countDocuments({ campaignId, status: 'failed' }),
    dataAccess.emailBroadcastRecipient.countDocuments({ campaignId, status: 'suppressed' }),
    dataAccess.emailBroadcastRecipient.countDocuments({ campaignId, status: 'unknown' })
  ]);
  const finished = queuedCount === 0 && sendingCount === 0;
  const status = finished
    ? unknownCount > 0 ? 'manual_review' : failedCount > 0 ? 'partial' : 'sent'
    : 'sending';
  await dataAccess.emailBroadcast.updateOne({ id: campaignId }, {
    sentCount,
    failedCount,
    suppressedCount,
    unknownCount,
    status,
    ...(finished ? { completedAt: new Date() } : {})
  });
  return { status, queuedCount, sendingCount, sentCount, failedCount, suppressedCount, unknownCount };
}

async function processAdminEmailBroadcastQueue(resend) {
  if (!dataAccess.isSupabaseRuntime()) return { processed: 0, skipped: true, reason: 'SUPABASE_RUNTIME_REQUIRED' };
  if (!resend?.batch?.send) return { processed: 0, skipped: true, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  const from = String(process.env.EMAIL_FROM || '').trim();
  if (!from || /resend\.dev/i.test(from)) return { processed: 0, skipped: true, reason: 'EMAIL_FROM_NOT_CONFIGURED' };

  const staleBefore = new Date(Date.now() - 20 * 60 * 1000);
  const stale = await dataAccess.emailBroadcastRecipient.updateMany(
    { status: 'sending', updatedAt: { $lt: staleBefore } },
    { $set: { status: 'unknown', lastError: 'WORKER_INTERRUPTED_AFTER_CLAIM; DELIVERY_NOT_RETRIED_TO_AVOID_DUPLICATES' } }
  );
  const campaigns = await dataAccess.emailBroadcast.find({ status: { $in: ['queued', 'sending'] } }, { sort: { createdAt: 1 }, limit: 10 });
  let campaign = null;
  for (const candidate of campaigns) {
    if (candidate.status === 'queued') {
      const claimed = await dataAccess.emailBroadcast.updateOne({ id: candidate.id || candidate._id, status: 'queued' }, {
        $set: { status: 'sending', startedAt: new Date() }
      });
      if (!claimed) continue;
      campaign = claimed;
    } else campaign = candidate;
    break;
  }
  if (!campaign) return { processed: 0, recoveredUnknown: stale.modifiedCount || 0, skipped: true, reason: 'NO_QUEUED_EMAIL_BROADCAST' };

  const campaignId = String(campaign.id || campaign._id);
  let recipients = [];
  try {
    recipients = await dataAccess.callSupabaseRpc('operix_claim_email_broadcast_recipients', {
      p_campaign_id: campaignId,
      p_batch_size: RESEND_BATCH_SIZE
    });
    if (!Array.isArray(recipients)) recipients = [];
    if (!recipients.length) {
      const totals = await updateCampaignTotals(campaignId);
      return { processed: 0, campaignId, ...totals };
    }

    const payload = recipients.map(recipient => {
      const unsubscribeUrl = buildUnsubscribeUrl(recipient.userId);
      const oneClickUnsubscribeUrl = `${String(process.env.APP_URL || 'https://operix.website').trim().replace(/\/+$/, '')}/api/email/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(recipient.userId))}`;
      const content = buildAnnouncementEmail({ subject: campaign.subject, body: campaign.body, unsubscribeUrl, oneClickUnsubscribeUrl });
      return {
        from,
        to: recipient.email,
        subject: campaign.subject,
        html: content.html,
        text: content.text,
        headers: content.headers
      };
    });
    const result = await resend.batch.send(payload);
    if (result?.error) throw new Error(result.error.message || 'EMAIL_PROVIDER_REJECTED_BATCH');
    await dataAccess.emailBroadcastRecipient.updateMany(
      { id: { $in: recipients.map(recipient => recipient.id) }, status: 'sending' },
      { $set: { status: 'sent', sentAt: new Date(), lastError: '' } }
    );
  } catch (error) {
    const errorText = safeProviderError(error);
    if (recipients.length) {
      await dataAccess.emailBroadcastRecipient.updateMany(
        { id: { $in: recipients.map(recipient => recipient.id) }, status: 'sending' },
        { $set: { status: 'failed', lastError: errorText } }
      ).catch(updateError => console.error('Unable to record email batch failure:', safeProviderError(updateError)));
    }
    await dataAccess.emailBroadcast.updateOne({ id: campaignId }, { $set: { lastError: errorText } }).catch(() => {});
    console.error(`Admin email broadcast batch failed (${campaignId}):`, errorText);
  }
  const totals = await updateCampaignTotals(campaignId);
  return { processed: recipients.length, campaignId, ...totals };
}

module.exports = {
  MAX_RECIPIENTS,
  RESEND_BATCH_SIZE,
  validateAnnouncement,
  normalizeRecipients,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildAnnouncementEmail,
  getEligibleRecipients,
  updateCampaignTotals,
  processAdminEmailBroadcastQueue
};
