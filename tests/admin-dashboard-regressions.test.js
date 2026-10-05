const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const adminController = require('../src/controllers/adminController');
const dataAccess = require('../src/services/dataAccess');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const adminHtml = read('admin.html');
const adminRoutes = read('src/routes/adminRoutes.js');
const controllerSource = read('src/controllers/adminController.js');

assert.match(adminHtml, /fetch\('\/api\/health', \{ cache: 'no-store' \}\)/, 'service status must use live health data');
assert.match(adminHtml, /health\.financialSchema\?\.ready/, 'service status must check financial schema readiness');
assert.doesNotMatch(adminHtml, /\+12%/, 'overview must not show a fabricated growth percentage');
assert.match(adminHtml, /طلبات مالية معلقة/, 'pending metric must include both deposits and withdrawals');
assert.match(adminHtml, /const totalsByDay = new Map\(\)/, 'overview chart must aggregate all transaction types per day');
assert.match(adminHtml, /api\/admin\/users\/export/, 'user CSV export must retrieve all filtered server results');
assert.match(adminHtml, /api\/admin\/referrals\/export/, 'referral CSV export must retrieve all filtered server results');
assert.match(adminHtml, /changeReferralsPage\(/, 'referral table must support pagination');
assert.doesNotMatch(adminHtml, /id="editUserTier"/, 'manual tier changes must not be offered from account administration');
const editUserFlow = adminHtml.slice(adminHtml.indexOf('async function submitEditUser()'), adminHtml.indexOf('function referralTreeNodeHtml'));
assert.doesNotMatch(editUserFlow, /\/api\/admin\/users\/tier/, 'the user editor must not submit a rejected manual tier change');
assert.match(editUserFlow, /for \(const \[label, run\] of operations\)/, 'user-account changes must run sequentially for clear partial-save handling');
assert.match(editUserFlow, /راجع البيانات وأعد المحاولة/, 'partial saves must be reported rather than hidden by closing the dialog');
assert.match(adminRoutes, /router\.get\('\/users\/export', requirePermission\('read_users'\), adminController\.exportUsers\)/);
assert.match(adminRoutes, /router\.get\('\/referrals\/export', requirePermission\('read_referrals'\), adminController\.exportReferrals\)/);
assert.match(adminRoutes, /router\.post\('\/email-broadcasts\/preview', requirePermission\('broadcast'\), adminController\.previewEmailBroadcast\)/);
assert.match(adminRoutes, /router\.post\('\/email-broadcasts', requirePermission\('broadcast'\), adminController\.createEmailBroadcast\)/);
assert.match(adminHtml, /معاينة المحتوى وعدد المستلمين/);
assert.match(adminHtml, /إرسال التحديث/);
assert.match(adminHtml, /emailBroadcastRecipientCount > 0/);
assert.match(controllerSource, /lastLoginAt: \{ \$gte: new Date\(Date\.now\(\) - 24 \* 60 \* 60 \* 1000\) \}/, 'active users must be based on actual last login, not profile updates');

function responseRecorder() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

(async () => {
  const originalFind = dataAccess.user.find;
  try {
    const users = [
      { id: 'u1', username: 'alpha', email: 'alpha@example.test', referralCode: 'ALPHA', role: 'user', tierCode: 'A1', wallet: { balance: 12, totalDeposits: 10, depositBalance: 10, profitBalance: 2 }, emailVerified: true, createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'u2', username: 'beta', email: 'beta@example.test', referralCode: 'BETA', referredBy: 'ALPHA', role: 'user', tierCode: 'A2', wallet: { balance: 20, totalDeposits: 20, depositBalance: 10, profitBalance: 10 }, emailVerified: false, createdAt: '2026-10-02T00:00:00.000Z' },
      { id: 'u3', username: 'gamma', email: 'gamma@example.test', referralCode: 'GAMMA', referredBy: 'ALPHA', role: 'user', tierCode: 'A1', wallet: { balance: 5, totalDeposits: 0 }, emailVerified: true, createdAt: '2026-10-03T00:00:00.000Z' }
    ];
    dataAccess.user.find = async () => users;

    const paginated = responseRecorder();
    await adminController.listUsers({ query: { page: '1', limit: '1' } }, paginated);
    assert.equal(paginated.body.total, 3);
    assert.equal(paginated.body.users.length, 1);

    const allUsersExport = responseRecorder();
    await adminController.exportUsers({ query: {} }, allUsersExport);
    assert.equal(allUsersExport.body.users.length, 3, 'CSV endpoint must return all rows rather than only the visible page');
    assert.equal(allUsersExport.body.users[0].username, 'alpha');

    const referralsPage = responseRecorder();
    await adminController.listReferrals({ query: { page: '1', limit: '1', search: 'ALPHA' } }, referralsPage);
    assert.equal(referralsPage.body.total, 2);
    assert.equal(referralsPage.body.referrals.length, 1);

    const allReferralsExport = responseRecorder();
    await adminController.exportReferrals({ query: { search: 'ALPHA' } }, allReferralsExport);
    assert.equal(allReferralsExport.body.referrals.length, 2, 'referral export must include every matching referral');
    assert.ok(allReferralsExport.body.referrals.every(item => item.referredBy === 'ALPHA'));

    console.log('Admin dashboard regression tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.user.find = originalFind;
  }
})();
