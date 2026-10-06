const assert = require('node:assert/strict');
const { sanitizeProfileUser } = require('../src/controllers/userController');

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
console.log('profile response safety tests: ok');
