const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dataAccess = require('../src/services/dataAccess');
const reminderService = require('../src/services/emailVerificationReminderService');
const adminController = require('../src/controllers/adminController');
const authControllerModule = require('../src/controllers/authController');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const migration = read('supabase/email-verification-reminders.sql');
const domainMigration = read('supabase/email-verification-reminder-domain-allowlist.sql');
const schema = read('supabase/schema.sql');
const routes = read('src/routes/adminRoutes.js');
const server = read('server.js');
const worker = read('.github/workflows/admin-email-broadcast-worker.yml');
const reminderOnlyWorker = read('.github/workflows/email-verification-reminder-worker.yml');
const adminUi = read('admin.html');
const authController = read('src/controllers/authController.js');
const emailTemplates = read('src/services/emailTemplates.js');
const serviceDomainBlock = read('src/services/emailVerificationReminderService.js').match(/ALLOWED_EMAIL_DOMAINS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || '';
const sqlDomainBlock = migration.match(/function public\.operix_email_verification_reminder_domain_allowed[\s\S]*?array\[([\s\S]*?)\]::text\[\]/i)?.[1] || '';
const serviceDomains = [...serviceDomainBlock.matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
const sqlDomains = [...sqlDomainBlock.matchAll(/'([^']+)'/g)].map(match => match[1]).sort();

assert.match(schema, /email_verification_token/i);
assert.match(migration, /email_verification_reminder_sent_at/i);
assert.match(migration, /email_verified\s*=\s*false/i);
assert.match(migration, /is_banned\s*=\s*false/i);
assert.match(migration, /email_updates_opt_out\s*=\s*false/i);
assert.match(migration, /interval '7 days'/i);
assert.match(migration, /operix_create_email_verification_reminder_atomic/i);
assert.match(migration, /operix_claim_email_verification_reminder_recipients/i);
assert.match(migration, /operix_prepare_email_verification_reminder_atomic/i);
assert.match(migration, /operix_email_verification_reminder_domain_allowed/i);
assert.match(migration, /last_error\s*=\s*'RECIPIENT_DOMAIN_NOT_ALLOWED'/i);
assert.match(migration, /operix_email_verification_reminder_domain_allowed\(email\)\s+and role = 'user'/i);
assert.deepEqual(sqlDomains, serviceDomains, 'runtime and database email provider allowlists must match');
assert.match(domainMigration, /create trigger email_verification_reminder_domain_guard/i);
assert.match(domainMigration, /RECIPIENT_DOMAIN_NOT_ALLOWED/);
assert.match(domainMigration, /update public\.email_verification_reminder_recipients[\s\S]*?status = 'queued'/i);
assert.deepEqual([...domainMigration.matchAll(/'([a-z0-9.-]+\.[a-z]{2,})'/gi)].map(match => match[1]).filter(domain => serviceDomains.includes(domain)).sort(), serviceDomains, 'production SQL allowlist must match the worker');
assert.match(migration, /for update skip locked/i);
assert.match(migration, /revoke all privileges on table public\.email_verification_reminder_campaigns from public, anon, authenticated/i);
assert.match(routes, /email-verification-reminders\/preview', requirePermission\('broadcast'/);
assert.match(routes, /email-verification-reminders', requirePermission\('broadcast'/);
assert.match(routes, /email-verification-reminders\/recover-rejected', requirePermission\('broadcast'/);
assert.match(reminderOnlyWorker, /process-email-verification-reminders/);
assert.doesNotMatch(reminderOnlyWorker, /process-email-broadcasts/);
assert.match(server, /process-email-verification-reminders/);
assert.match(worker, /process-email-verification-reminders/);
assert.match(adminUi, /تذكير توثيق البريد للحسابات غير الموثّقة/);
assert.match(adminUi, /إرسال تذكيرات التوثيق/);
assert.match(authController, /createHash\('sha256'\)\.update\(token\)/);
assert.match(emailTemplates, /function emailVerificationTemplate/);

assert.deepEqual(reminderService.normalizeRecipients([
  { id: 'user-1', email: 'NotVerified@gmail.com' },
  { id: 'user-2', email: 'notverified@gmail.com' },
  { id: 'user-3', email: 'invalid' },
  { id: 'user-4', email: 'fake@example.com' },
  { id: 'user-5', email: 'qa@example.test' },
  { id: 'user-6', email: 'throwaway@mailinator.com' },
  { id: '', email: 'missing-id@hotmail.com' }
]), [{ userId: 'user-1', email: 'notverified@gmail.com' }]);
assert.equal(reminderService.isAllowedRecipientEmail('valid@hotmail.com'), true);
assert.equal(reminderService.isAllowedRecipientEmail('valid@outlook.com'), true);
assert.equal(reminderService.isAllowedRecipientEmail('valid@example.org'), false);
assert.equal(reminderService.isAllowedRecipientEmail('valid@example.test'), false);

function responseRecorder() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}

(async () => {
  const originals = {
    isSupabaseRuntime: dataAccess.isSupabaseRuntime,
    findRecipients: dataAccess.user.findEmailVerificationReminderRecipients,
    rpc: dataAccess.callSupabaseRpc,
    campaignFind: dataAccess.emailVerificationReminderCampaign.find,
    recipientFind: dataAccess.emailVerificationReminderRecipient.find,
    campaignUpdate: dataAccess.emailVerificationReminderCampaign.updateOne,
    recipientCount: dataAccess.emailVerificationReminderRecipient.countDocuments,
    recipientUpdate: dataAccess.emailVerificationReminderRecipient.updateMany,
    userFindOne: dataAccess.user.findOne,
    userUpdateOne: dataAccess.user.updateOne,
    securityEventCreate: dataAccess.securityEvent.create
  };
  const previousFrom = process.env.EMAIL_FROM;
  const previousAppUrl = process.env.APP_URL;
  const recipient = { id: '423e4567-e89b-42d3-a456-426614174000', userId: '123e4567-e89b-42d3-a456-426614174000', email: 'pending@gmail.com', status: 'sending' };
  const campaignId = '223e4567-e89b-42d3-a456-426614174000';
  const calls = [];
  const sentMessages = [];
  try {
    process.env.EMAIL_FROM = 'OPERIX <verify@operix.website>';
    process.env.APP_URL = 'https://operix.website';
    dataAccess.isSupabaseRuntime = () => true;
    const failedCampaign = { id: campaignId, status: 'partial', recipientCount: 2, sentCount: 0, failedCount: 2, lastError: 'Invalid `to` field. Please use our testing email address instead of domains like example.com.' };
    const recoverableUsers = new Map([
      ['recover-1', { id: 'recover-1', email: 'valid@gmail.com', role: 'user', isBanned: false, emailVerified: false, emailUpdatesOptOut: false, emailVerificationReminderSentAt: new Date() }],
      ['recover-2', { id: 'recover-2', email: 'qa@example.com', role: 'user', isBanned: false, emailVerified: false, emailUpdatesOptOut: false, emailVerificationReminderSentAt: new Date() }]
    ]);
    const recoveredUsers = [];
    dataAccess.emailVerificationReminderCampaign.find = async () => [failedCampaign];
    dataAccess.emailVerificationReminderRecipient.find = async () => [
      { id: 'recipient-1', userId: 'recover-1', email: 'valid@gmail.com', status: 'failed' },
      { id: 'recipient-2', userId: 'recover-2', email: 'qa@example.com', status: 'failed' }
    ];
    dataAccess.user.findOne = async query => recoverableUsers.get(query.id) || null;
    dataAccess.user.updateOne = async query => {
      recoveredUsers.push(query.id);
      return { id: query.id };
    };

    const recoveryNoConfirmation = responseRecorder();
    await adminController.recoverRejectedEmailVerificationReminders({ body: {} }, recoveryNoConfirmation);
    assert.equal(recoveryNoConfirmation.statusCode, 400);

    const recovery = responseRecorder();
    await adminController.recoverRejectedEmailVerificationReminders({
      body: { confirmed: true, confirmation: 'استعادة العناوين المرفوضة' },
      user: { id: '323e4567-e89b-42d3-a456-426614174000' }
    }, recovery);
    assert.equal(recovery.statusCode, 200);
    assert.equal(recovery.body.recoveredCount, 1, 'only failed recipients on allowed real-provider domains can have cooldown reset');
    assert.deepEqual(recoveredUsers, ['recover-1']);

    dataAccess.user.findEmailVerificationReminderRecipients = async () => [
      { id: recipient.userId, email: recipient.email },
      { id: '523e4567-e89b-42d3-a456-426614174000', email: 'PENDING@gmail.com' },
      { id: '623e4567-e89b-42d3-a456-426614174000', email: 'seed@example.com' }
    ];

    const preview = responseRecorder();
    await adminController.previewEmailVerificationReminders({
      app: { locals: { resend: { batch: { send: async () => ({}) } } } }
    }, preview);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.recipientCount, 1, 'duplicate email addresses are deduplicated');

    dataAccess.callSupabaseRpc = async (name, args) => {
      calls.push({ name, args });
      if (name === 'operix_create_email_verification_reminder_atomic') return { id: campaignId, recipientCount: 1 };
      if (name === 'operix_claim_email_verification_reminder_recipients') return [{ ...recipient }];
      if (name === 'operix_prepare_email_verification_reminder_atomic') return true;
      throw new Error(`Unexpected RPC: ${name}`);
    };

    const noConfirmation = responseRecorder();
    await adminController.createEmailVerificationReminders({
      body: {},
      user: { id: '323e4567-e89b-42d3-a456-426614174000' },
      app: { locals: { resend: { batch: { send: async () => ({}) } } } }
    }, noConfirmation);
    assert.equal(noConfirmation.statusCode, 400);

    const created = responseRecorder();
    await adminController.createEmailVerificationReminders({
      body: { confirmed: true, confirmation: 'إرسال تذكيرات التوثيق' },
      user: { id: '323e4567-e89b-42d3-a456-426614174000' },
      app: { locals: { resend: { batch: { send: async () => ({}) } } } }
    }, created);
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.recipientCount, 1);
    assert.equal(calls.filter(call => call.name === 'operix_create_email_verification_reminder_atomic').length, 1);

    let campaignStatus = 'queued';
    dataAccess.emailVerificationReminderCampaign.find = async () => [
      { id: campaignId, status: campaignStatus, recipientCount: 1 }
    ];
    dataAccess.emailVerificationReminderCampaign.updateOne = async (_filter, change) => {
      const values = change.$set || change;
      campaignStatus = values.status || campaignStatus;
      return { id: campaignId, status: campaignStatus, ...values };
    };
    dataAccess.emailVerificationReminderRecipient.countDocuments = async query => recipient.status === query.status ? 1 : 0;
    dataAccess.emailVerificationReminderRecipient.updateMany = async (query, change) => {
      const values = change.$set || change;
      if (query.id?.$in?.includes(recipient.id) && recipient.status === query.status) Object.assign(recipient, values);
      return { matchedCount: 1, modifiedCount: 1 };
    };
    const result = await reminderService.processQueue({ batch: { send: async messages => {
      sentMessages.push(...messages);
      return { data: { data: [{ id: 'resend-verification-reminder-1' }] } };
    } } });
    assert.equal(result.processed, 1);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, recipient.email);
    assert.match(sentMessages[0].subject, /توثيق بريد حسابك/);

    const prepareCall = calls.find(call => call.name === 'operix_prepare_email_verification_reminder_atomic');
    assert.ok(prepareCall);
    assert.match(prepareCall.args.p_token, /^[a-f0-9]{64}$/);
    const rawToken = new URL(sentMessages[0].html.match(/href="([^"]*verify-email\?token=[^"]+)"/)[1]).searchParams.get('token');
    assert.equal(crypto.createHash('sha256').update(rawToken).digest('hex'), prepareCall.args.p_token, 'only the hash is stored; raw token is emailed');
    assert.equal(recipient.status, 'sent');

    const verificationLookups = [];
    dataAccess.user.findOne = async query => {
      verificationLookups.push(query);
      return query.emailVerificationToken === prepareCall.args.p_token
        ? { id: recipient.userId, email: recipient.email }
        : null;
    };
    dataAccess.user.updateOne = async () => ({ id: recipient.userId });
    dataAccess.securityEvent.create = async () => ({});
    const verifiedResponse = responseRecorder();
    await authControllerModule.verifyEmail({
      query: { token: rawToken },
      ip: '127.0.0.1',
      get: () => 'test-agent'
    }, verifiedResponse);
    assert.equal(verifiedResponse.statusCode, 200);
    assert.match(verifiedResponse.body, /تم تأكيد البريد بنجاح/);
    assert.equal(verificationLookups[0].emailVerificationToken, rawToken);
    assert.equal(verificationLookups[1].emailVerificationToken, prepareCall.args.p_token);

    console.log('Email verification reminder tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.isSupabaseRuntime = originals.isSupabaseRuntime;
    dataAccess.user.findEmailVerificationReminderRecipients = originals.findRecipients;
    dataAccess.callSupabaseRpc = originals.rpc;
    dataAccess.emailVerificationReminderCampaign.find = originals.campaignFind;
    dataAccess.emailVerificationReminderRecipient.find = originals.recipientFind;
    dataAccess.emailVerificationReminderCampaign.updateOne = originals.campaignUpdate;
    dataAccess.emailVerificationReminderRecipient.countDocuments = originals.recipientCount;
    dataAccess.emailVerificationReminderRecipient.updateMany = originals.recipientUpdate;
    dataAccess.user.findOne = originals.userFindOne;
    dataAccess.user.updateOne = originals.userUpdateOne;
    dataAccess.securityEvent.create = originals.securityEventCreate;
    if (previousFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previousFrom;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
})();
