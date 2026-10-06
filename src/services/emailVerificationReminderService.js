const crypto = require('node:crypto');
const dataAccess = require('./dataAccess');
const { emailVerificationTemplate } = require('./emailTemplates');

const MAX_RECIPIENTS = 10000;
const BATCH_SIZE = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_EMAIL_DOMAINS = new Set([
  'operix.website',
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.it', 'hotmail.ca', 'hotmail.com.au', 'hotmail.com.tr',
  'live.com', 'live.co.uk', 'live.fr', 'live.de', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.ca', 'yahoo.com.au', 'yahoo.co.jp', 'yahoo.co.in', 'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'tuta.com', 'tuta.io', 'tutanota.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'zoho.com', 'zohomail.com',
  'fastmail.com', 'fastmail.fm', 'hey.com',
  'yandex.com', 'yandex.ru', 'yandex.kz', 'yandex.uz',
  'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'rambler.ru',
  'qq.com', '163.com', '126.com', 'yeah.net', 'naver.com', 'daum.net', 'hanmail.net', 'rediffmail.com',
  'orange.fr', 'laposte.net', 'free.fr', 'seznam.cz', 'email.cz', 'wp.pl', 'onet.pl', 'interia.pl', 'o2.pl', 't-online.de', 'freenet.de', 'btinternet.com', 'virginmedia.com'
]);

function isAllowedRecipientEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalizedEmail)) return false;
  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1);
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

function normalizeRecipients(users = []) {
  const recipients = new Map();
  for (const user of Array.isArray(users) ? users : []) {
    const userId = String(user.id || user._id || '').trim();
    const email = String(user.email || '').trim().toLowerCase();
    if (!userId || !isAllowedRecipientEmail(email) || recipients.has(email)) continue;
    recipients.set(email, { userId, email });
  }
  return [...recipients.values()];
}

async function getEligibleRecipients() {
  if (!dataAccess.isSupabaseRuntime()) throw new Error('SUPABASE_RUNTIME_REQUIRED');
  const users = await dataAccess.user.findEmailVerificationReminderRecipients(MAX_RECIPIENTS + 1);
  const recipients = normalizeRecipients(users);
  if (users.length > MAX_RECIPIENTS || recipients.length > MAX_RECIPIENTS) {
    throw new Error(`RECIPIENT_LIMIT_EXCEEDED:${MAX_RECIPIENTS}`);
  }
  return recipients;
}

function safeError(error) {
  return String(error?.message || error || 'EMAIL_PROVIDER_ERROR').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

async function updateCampaignTotals(campaignId) {
  const [queued, sending, sent, failed, suppressed, unknown] = await Promise.all([
    dataAccess.emailVerificationReminderRecipient.countDocuments({ campaignId, status: 'queued' }),
    dataAccess.emailVerificationReminderRecipient.countDocuments({ campaignId, status: 'sending' }),
    dataAccess.emailVerificationReminderRecipient.countDocuments({ campaignId, status: 'sent' }),
    dataAccess.emailVerificationReminderRecipient.countDocuments({ campaignId, status: 'failed' }),
    dataAccess.emailVerificationReminderRecipient.countDocuments({ campaignId, status: 'suppressed' }),
    dataAccess.emailVerificationReminderRecipient.countDocuments({ campaignId, status: 'unknown' })
  ]);
  const finished = queued === 0 && sending === 0;
  const status = finished
    ? unknown > 0 ? 'manual_review' : failed > 0 ? 'partial' : 'sent'
    : 'sending';
  await dataAccess.emailVerificationReminderCampaign.updateOne({ id: campaignId }, {
    sentCount: sent,
    failedCount: failed,
    suppressedCount: suppressed,
    unknownCount: unknown,
    status,
    ...(finished ? { completedAt: new Date() } : {})
  });
  return { status, queuedCount: queued, sendingCount: sending, sentCount: sent, failedCount: failed, suppressedCount: suppressed, unknownCount: unknown };
}

async function processQueue(resend) {
  if (!dataAccess.isSupabaseRuntime()) return { processed: 0, skipped: true, reason: 'SUPABASE_RUNTIME_REQUIRED' };
  if (!resend?.batch?.send) return { processed: 0, skipped: true, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  const from = String(process.env.EMAIL_FROM || '').trim();
  if (!from || /resend\.dev/i.test(from)) return { processed: 0, skipped: true, reason: 'EMAIL_FROM_NOT_CONFIGURED' };

  const staleBefore = new Date(Date.now() - 20 * 60 * 1000);
  const stale = await dataAccess.emailVerificationReminderRecipient.updateMany(
    { status: 'sending', updatedAt: { $lt: staleBefore } },
    { $set: { status: 'unknown', lastError: 'WORKER_INTERRUPTED; DELIVERY_NOT_RETRIED_TO_AVOID_DUPLICATES' } }
  );
  const campaigns = await dataAccess.emailVerificationReminderCampaign.find(
    { status: { $in: ['queued', 'sending'] } },
    { sort: { createdAt: 1 }, limit: 10 }
  );
  let campaign = null;
  for (const candidate of campaigns) {
    if (candidate.status === 'queued') {
      const claimed = await dataAccess.emailVerificationReminderCampaign.updateOne(
        { id: candidate.id || candidate._id, status: 'queued' },
        { $set: { status: 'sending', startedAt: new Date() } }
      );
      if (!claimed?.id) continue;
      campaign = claimed;
    } else campaign = candidate;
    break;
  }
  if (!campaign) return { processed: 0, recoveredUnknown: stale.modifiedCount || 0, skipped: true, reason: 'NO_QUEUED_VERIFICATION_REMINDERS' };

  const campaignId = String(campaign.id || campaign._id);
  let recipients = [];
  try {
    recipients = await dataAccess.callSupabaseRpc('operix_claim_email_verification_reminder_recipients', {
      p_campaign_id: campaignId,
      p_batch_size: BATCH_SIZE
    });
    if (!Array.isArray(recipients)) recipients = [];
    const prepared = [];
    for (const recipient of recipients) {
      if (!isAllowedRecipientEmail(recipient.email)) {
        await dataAccess.emailVerificationReminderRecipient.updateOne(
          { id: recipient.id, status: 'sending' },
          { $set: { status: 'suppressed', lastError: 'RECIPIENT_DOMAIN_NOT_ALLOWED' } }
        );
        continue;
      }
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const updated = await dataAccess.callSupabaseRpc('operix_prepare_email_verification_reminder_atomic', {
        p_user_id: recipient.userId,
        p_email: recipient.email,
        p_token: crypto.createHash('sha256').update(token).digest('hex'),
        p_expires_at: expiresAt.toISOString()
      });
      if (updated !== true) {
        await dataAccess.emailVerificationReminderRecipient.updateOne(
          { id: recipient.id, status: 'sending' },
          { $set: { status: 'suppressed', lastError: 'ACCOUNT_NO_LONGER_ELIGIBLE' } }
        );
        continue;
      }
      const verifyUrl = `${String(process.env.APP_URL || 'https://operix.website').trim().replace(/\/+$/, '')}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
      prepared.push({
        recipient,
        email: {
          from,
          to: recipient.email,
          subject: 'يرجى توثيق بريد حسابك - OPERIX',
          html: emailVerificationTemplate({ verifyUrl, userEmail: recipient.email })
        }
      });
    }

    if (prepared.length) {
      const result = await resend.batch.send(prepared.map(item => item.email));
      if (result?.error) throw new Error(result.error.message || 'EMAIL_PROVIDER_REJECTED_BATCH');
      await dataAccess.emailVerificationReminderRecipient.updateMany(
        { id: { $in: prepared.map(item => item.recipient.id) }, status: 'sending' },
        { $set: { status: 'sent', sentAt: new Date(), lastError: '' } }
      );
    }
  } catch (error) {
    const errorText = safeError(error);
    if (recipients.length) {
      await dataAccess.emailVerificationReminderRecipient.updateMany(
        { id: { $in: recipients.map(recipient => recipient.id) }, status: 'sending' },
        { $set: { status: 'failed', lastError: errorText } }
      ).catch(updateError => console.error('Unable to record verification reminder failure:', safeError(updateError)));
    }
    await dataAccess.emailVerificationReminderCampaign.updateOne(
      { id: campaignId },
      { $set: { lastError: errorText } }
    ).catch(() => {});
    console.error(`Email verification reminder batch failed (${campaignId}):`, errorText);
  }

  const totals = await updateCampaignTotals(campaignId);
  return { processed: recipients.length, campaignId, ...totals };
}

module.exports = { MAX_RECIPIENTS, BATCH_SIZE, ALLOWED_EMAIL_DOMAINS, isAllowedRecipientEmail, normalizeRecipients, getEligibleRecipients, updateCampaignTotals, processQueue };
