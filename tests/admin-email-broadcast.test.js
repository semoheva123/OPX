const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataAccess = require('../src/services/dataAccess');
const emailService = require('../src/services/adminEmailBroadcastService');
const adminController = require('../src/controllers/adminController');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const migration = read('supabase/admin-email-broadcasts.sql');
const schema = read('supabase/schema.sql');
const routes = read('src/routes/adminRoutes.js');
const publicRoutes = read('src/routes/publicRoutes.js');
const preferences = read('src/controllers/emailPreferenceController.js');
const app = read('server.js');
const worker = read('.github/workflows/admin-email-broadcast-worker.yml');
const targetedWorker = read('.github/workflows/single-email-broadcast-worker.yml');
const domainMigration = read('supabase/email-verification-reminder-domain-allowlist.sql');
const adminUi = read('admin.html');
const privacy = read('privacy.html');
const terms = read('terms.html');

const previousSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
const previousFrom = process.env.EMAIL_FROM;
process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-only-unsubscribe-signing-secret';
process.env.EMAIL_FROM = 'OPERIX <updates@operix.website>';

assert.throws(() => emailService.validateAnnouncement('', 'message'), /SUBJECT_LENGTH_INVALID/);
assert.throws(() => emailService.validateAnnouncement('subject', 'x'.repeat(5001)), /BODY_LENGTH_INVALID/);
assert.deepEqual(emailService.validateAnnouncement(' Update ', ' New feature\n\nDetails '), { subject: 'Update', body: 'New feature\n\nDetails' });

const recipients = emailService.normalizeRecipients([
  { id: 'user-1', email: 'A@gmail.com' },
  { id: 'user-2', email: 'a@gmail.com' },
  { id: 'user-3', email: 'invalid' },
  { id: 'user-4', email: 'b@hotmail.com' },
  { id: 'user-5', email: 'test@example.com' }
]);
assert.deepEqual(recipients, [{ userId: 'user-1', email: 'a@gmail.com' }, { userId: 'user-4', email: 'b@hotmail.com' }]);

const validToken = emailService.createUnsubscribeToken('123e4567-e89b-42d3-a456-426614174000');
assert.equal(emailService.verifyUnsubscribeToken(validToken), '123e4567-e89b-42d3-a456-426614174000');
assert.equal(emailService.verifyUnsubscribeToken(`${validToken}tampered`), null);
const announcement = emailService.buildAnnouncementEmail({ subject: '<hello>', body: '<script>alert(1)</script>', unsubscribeUrl: 'https://operix.website/email-unsubscribe.html?token=x', oneClickUnsubscribeUrl: 'https://operix.website/api/email/unsubscribe?token=x' });
assert.match(announcement.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'announcement body must be HTML-escaped');
assert.doesNotMatch(announcement.html, /<script>alert/);
assert.match(announcement.headers['List-Unsubscribe-Post'], /One-Click/);
assert.match(announcement.text, /إلغاء الاشتراك/);

for (const source of [migration, schema]) {
  assert.match(source, /email_updates_opt_out/i);
  assert.match(source, /email_broadcasts/i);
  assert.match(source, /email_broadcast_recipients/i);
}
assert.match(migration, /email_verified\s*=\s*true/i);
assert.match(migration, /is_banned\s*=\s*false/i);
assert.match(migration, /email_updates_opt_out\s*=\s*false/i);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /EMAIL_BROADCAST_AUDIENCE_CHANGED/i);
assert.match(migration, /revoke all privileges on table public\.email_broadcasts from public, anon, authenticated/i);
assert.match(routes, /router\.post\('\/email-broadcasts\/preview', requirePermission\('broadcast'\)/);
assert.match(routes, /router\.post\('\/email-broadcasts', requirePermission\('broadcast'\)/);
assert.match(publicRoutes, /emailPreferenceController\.unsubscribeFromUpdates/);
assert.match(preferences, /verifyUnsubscribeToken/);
assert.match(app, /process-email-broadcasts/);
assert.match(worker, /CRON_SECRET/);
assert.match(worker, /process-email-broadcasts/);
assert.match(targetedWorker, /inputs\.campaign_id/);
assert.match(targetedWorker, /process-email-broadcasts/);
assert.match(targetedWorker, /CAMPAIGN_ID/);
assert.match(domainMigration, /email_broadcast_recipient_domain_guard/i);
assert.match(domainMigration, /update public\.email_broadcast_recipients[\s\S]*?RECIPIENT_DOMAIN_NOT_ALLOWED/i);
assert.match(adminUi, /معاينة المحتوى وعدد المستلمين/);
assert.match(adminUi, /إرسال التحديث/);
assert.match(adminUi, /تغيّر النص؛ أعد المعاينة/);
assert.match(adminUi, /requestedDraftKey/);
assert.match(adminUi, /emailBroadcastDeliveryReady/);
assert.match(adminUi, /عامل الإرسال المجدول/);
assert.match(privacy, /إيقاف رسائل التحديثات/);
assert.match(terms, /إلغاء رسائل التحديثات/);

function responseRecorder() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

(async () => {
  const originals = {
    isSupabaseRuntime: dataAccess.isSupabaseRuntime,
    findRecipients: dataAccess.user.findEmailBroadcastRecipients,
    rpc: dataAccess.callSupabaseRpc,
    broadcastFind: dataAccess.emailBroadcast.find,
    broadcastUpdate: dataAccess.emailBroadcast.updateOne,
    recipientCount: dataAccess.emailBroadcastRecipient.countDocuments,
    recipientUpdate: dataAccess.emailBroadcastRecipient.updateMany
  };
  try {
    dataAccess.isSupabaseRuntime = () => true;
    dataAccess.user.findEmailBroadcastRecipients = async () => [
      { id: '123e4567-e89b-42d3-a456-426614174000', email: 'member@gmail.com' },
      { id: '523e4567-e89b-42d3-a456-426614174000', email: 'fake@example.com' }
    ];
    const preview = responseRecorder();
    await adminController.previewEmailBroadcast({ body: { subject: 'Update', body: 'A new feature' } }, preview);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.recipientCount, 1, 'preview excludes non-allowlisted test domains');
    assert.equal(preview.body.deliveryReadiness.providerConfigured, false);
    assert.equal(preview.body.deliveryReadiness.senderConfigured, true);
    assert.equal(preview.body.deliveryReadiness.unsubscribeConfigured, true);
    assert.equal(preview.body.deliveryReadiness.ready, false);

    const queueCalls = [];
    dataAccess.callSupabaseRpc = async (name, args) => {
      queueCalls.push({ name, args });
      return { id: '223e4567-e89b-42d3-a456-426614174000', recipientCount: 1 };
    };
    const unconfirmed = responseRecorder();
    await adminController.createEmailBroadcast({
      body: { subject: 'Update', body: 'A new feature' },
      user: { id: '323e4567-e89b-42d3-a456-426614174000' },
      get: () => '',
      app: { locals: { resend: { batch: { send: async () => ({ data: [] }) } } } }
    }, unconfirmed);
    assert.equal(unconfirmed.statusCode, 400);
    assert.equal(queueCalls.length, 0, 'queue creation must require the exact typed confirmation');

    const created = responseRecorder();
    await adminController.createEmailBroadcast({
      body: { subject: 'Update', body: 'A new feature', confirmed: true, confirmation: 'إرسال التحديث' },
      user: { id: '323e4567-e89b-42d3-a456-426614174000' },
      get: () => '',
      app: { locals: { resend: { batch: { send: async () => ({ data: [] }) } } } }
    }, created);
    assert.equal(created.statusCode, 202);
    assert.equal(queueCalls.length, 1);
    assert.equal(queueCalls[0].args.p_recipients.length, 1);

    const recipientRows = new Map([['423e4567-e89b-42d3-a456-426614174000', { id: '423e4567-e89b-42d3-a456-426614174000', userId: '123e4567-e89b-42d3-a456-426614174000', email: 'member@gmail.com', status: 'sending' }]]);
    let campaignStatus = 'queued';
    const campaignSearches = [];
    dataAccess.emailBroadcast.find = async query => {
      campaignSearches.push(query);
      if (query.id === '223e4567-e89b-42d3-a456-426614174000') return [{ id: query.id, subject: 'Update', body: 'New', status: campaignStatus }];
      if (query.id) return [];
      return [{ id: 'older-queued-campaign', subject: 'Unrelated', body: 'Old', status: 'queued' }];
    };
    dataAccess.emailBroadcast.updateOne = async (_filter, changes) => {
      const values = changes.$set || changes;
      campaignStatus = values.status || campaignStatus;
      return { id: '223e4567-e89b-42d3-a456-426614174000', ...values };
    };
    dataAccess.emailBroadcastRecipient.countDocuments = async (_query) => 0;
    dataAccess.emailBroadcastRecipient.updateMany = async (query, changes) => {
      if (query.id?.$in) {
        const values = changes.$set || changes;
        for (const id of query.id.$in) if (recipientRows.has(id)) Object.assign(recipientRows.get(id), values);
        return { matchedCount: query.id.$in.length, modifiedCount: query.id.$in.length };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    };
    dataAccess.callSupabaseRpc = async () => [...recipientRows.values()];
    const sentBatches = [];
    const result = await emailService.processAdminEmailBroadcastQueue({ batch: { send: async emails => { sentBatches.push(emails); return { data: { data: [{ id: 'resend-email-1' }] } }; } } });
    assert.equal(result.processed, 1);
    assert.equal(sentBatches.length, 1);
    assert.equal(sentBatches[0][0].to, 'member@gmail.com');
    assert.ok(sentBatches[0][0].headers['List-Unsubscribe']);
    assert.equal(recipientRows.get('423e4567-e89b-42d3-a456-426614174000').status, 'sent');

    campaignStatus = 'queued';
    dataAccess.callSupabaseRpc = async () => [];
    const targeted = await emailService.processAdminEmailBroadcastQueue(
      { batch: { send: async emails => { sentBatches.push(emails); return { data: { data: [] } }; } } },
      '223e4567-e89b-42d3-a456-426614174000'
    );
    assert.equal(campaignSearches.at(-1).id, '223e4567-e89b-42d3-a456-426614174000');
    assert.equal(targeted.campaignId, '223e4567-e89b-42d3-a456-426614174000');
    assert.equal(targeted.processed, 0);
    assert.equal(sentBatches.length, 1, 'targeted worker must not send other queued campaign content');

    const fakeRecipient = { id: '623e4567-e89b-42d3-a456-426614174000', userId: '523e4567-e89b-42d3-a456-426614174000', email: 'qa@example.com', status: 'sending' };
    recipientRows.set(fakeRecipient.id, fakeRecipient);
    campaignStatus = 'queued';
    dataAccess.callSupabaseRpc = async () => [fakeRecipient];
    const suppressed = await emailService.processAdminEmailBroadcastQueue(
      { batch: { send: async emails => { sentBatches.push(emails); return { data: { data: [] } }; } } },
      '223e4567-e89b-42d3-a456-426614174000'
    );
    assert.equal(recipientRows.get(fakeRecipient.id).status, 'suppressed');
    assert.equal(recipientRows.get(fakeRecipient.id).lastError, 'RECIPIENT_DOMAIN_NOT_ALLOWED');
    assert.equal(sentBatches.length, 1, 'claimed test-domain recipients must be suppressed before provider submission');
    assert.equal(suppressed.processed, 1);

    const invalidTarget = await emailService.processAdminEmailBroadcastQueue(
      { batch: { send: async () => { throw new Error('must not send'); } } },
      'not-a-uuid'
    );
    assert.equal(invalidTarget.reason, 'INVALID_EMAIL_BROADCAST_CAMPAIGN_ID');
    console.log('Admin email broadcast tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.isSupabaseRuntime = originals.isSupabaseRuntime;
    dataAccess.user.findEmailBroadcastRecipients = originals.findRecipients;
    dataAccess.callSupabaseRpc = originals.rpc;
    dataAccess.emailBroadcast.find = originals.broadcastFind;
    dataAccess.emailBroadcast.updateOne = originals.broadcastUpdate;
    dataAccess.emailBroadcastRecipient.countDocuments = originals.recipientCount;
    dataAccess.emailBroadcastRecipient.updateMany = originals.recipientUpdate;
    if (previousSecret === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    else process.env.EMAIL_UNSUBSCRIBE_SECRET = previousSecret;
    if (previousFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previousFrom;
  }
})();
