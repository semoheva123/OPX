const assert = require('node:assert/strict');
const { sanitizeProfileUser } = require('../src/controllers/userController');
const userController = require('../src/controllers/userController');
const dataAccess = require('../src/services/dataAccess');

const input = {
  id: 'user-1',
  email: 'member@example.com',
  tierCode: 'A2',
  wallet: { balance: 12.5 },
  password: 'hashed-password',
  passwordHash: 'legacy-hash',
  resetOtp: 'hashed-otp',
  resetOtpExpire: '2030-01-01T00:00:00.000Z',
  resetOtpAttempts: 3,
  twoFactorCode: '123456',
  twoFactorSecret: 'user-totp-secret',
  twoFactorExpire: '2030-01-01T00:00:00.000Z',
  adminTwoFactorSecret: 'admin-totp-secret',
  emailVerificationToken: 'verification-token',
  emailVerificationExpire: '2030-01-01T00:00:00.000Z',
  adminInviteToken: 'invite-token',
  adminInviteExpire: '2030-01-01T00:00:00.000Z',
  metadata: { officialPlatform: true, resetOtp: 'nested-otp', adminTwoFactorSecret: 'nested-secret' }
};

const safe = sanitizeProfileUser(input);

assert.equal(safe.email, input.email);
assert.equal(safe.tierCode, input.tierCode);
assert.deepEqual(safe.wallet, input.wallet);
for (const key of [
  'password', 'passwordHash', 'resetOtp', 'resetOtpExpire', 'resetOtpAttempts', 'twoFactorCode', 'twoFactorSecret',
  'twoFactorExpire', 'adminTwoFactorSecret', 'emailVerificationToken', 'emailVerificationExpire', 'adminInviteToken',
  'adminInviteExpire', 'metadata'
]) {
  assert.equal(Object.hasOwn(safe, key), false, `${key} must not be included in profile responses`);
}
assert.equal(input.twoFactorSecret, 'user-totp-secret', 'sanitization must not mutate the source user');

const originalFindById = dataAccess.user.findById;
const originalUserFind = dataAccess.user.find;
const originalTransactionExists = dataAccess.transaction.exists;

(async () => {
  try {
    dataAccess.user.findById = async () => ({
      id: 'tier-user-1',
      email: 'member@example.test',
      tierCode: 'A4',
      referralCode: 'MEMBER4',
      wallet: { totalDeposits: 0, depositBalance: 0, profitBalance: 100 }
    });
    dataAccess.user.find = async () => [];
    dataAccess.transaction.exists = async () => { throw new Error('Profile must not depend on a transaction-history query to load'); };

    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await userController.getProfile({ user: { id: 'tier-user-1' }, app: { locals: { gameSettings: {} } } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.user.tierCode, 'A4', 'persisted tier code must be returned after profile reload');
    assert.equal(response.body.user.isTierActivated, true,
      'a persisted non-default tier must remain active when total historical deposits are zero');
    console.log('profile response safety and tier activation tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.user.findById = originalFindById;
    dataAccess.user.find = originalUserFind;
    dataAccess.transaction.exists = originalTransactionExists;
  }
})();
