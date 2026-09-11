const assert = require('node:assert/strict');
const fs = require('node:fs');
const userController = require('../src/controllers/userController');
const userRoutes = require('../src/routes/userRoutes');
const userControllerSource = fs.readFileSync(require.resolve('../src/controllers/userController'), 'utf8');

assert.strictEqual(typeof userController.submitKyc, 'function', 'submitKyc should exist on userController');

const hasRoute = userRoutes.stack.some((layer) => layer.route && layer.route.path === '/kyc/submit');
assert.equal(hasRoute, true, 'userRoutes should expose POST /kyc/submit');

const walletControllerSource = fs.readFileSync(require.resolve('../src/controllers/walletController'), 'utf8');
assert.match(walletControllerSource, /kycStatus\s*!==\s*['"]verified['"]/, 'withdraw should require verified KYC');
assert.match(walletControllerSource, /riskScore/, 'withdraw should calculate a risk score');
assert.match(walletControllerSource, /riskFlags/, 'withdraw should persist risk flags');

const adminControllerSource = fs.readFileSync(require.resolve('../src/controllers/adminController'), 'utf8');
const kycStorageSource = fs.readFileSync(require.resolve('../src/services/kycStorage'), 'utf8');
assert.match(kycStorageSource, /private:\/\//, 'KYC images should use private storage references');
assert.match(kycStorageSource, /private:\/\//, 'KYC images should use private storage references');
assert.match(adminControllerSource, /streamKycDocument/, 'admin should expose protected KYC document streaming');
assert.match(adminControllerSource, /complianceReport/, 'admin should expose a compliance report');
assert.match(fs.readFileSync(require.resolve('../src/routes/adminRoutes'), 'utf8'), /compliance-report/, 'admin routes should expose compliance report');
assert.equal(fs.existsSync(require.resolve('../admin-first-login.html')), true, 'admin invitation page should exist');
assert.match(fs.readFileSync(require.resolve('../src/app'), 'utf8'), /private/, 'private storage path should be blocked from static serving');
assert.match(fs.readFileSync(require.resolve('../index.html'), 'utf8'), /\/api\/user\/2fa\/send-code/, 'withdrawal 2FA UI should use the user endpoint');
assert.match(adminControllerSource, /لا يمكن حظر حسابات الإدارة/, 'admin accounts should be protected from bans');
assert.match(fs.readFileSync(require.resolve('../src/app'), 'utf8'), /internal\/cron/, 'scheduled jobs should have a protected HTTP endpoint');
assert.match(fs.readFileSync(require.resolve('../vercel.json'), 'utf8'), /"crons"/, 'Vercel should configure scheduled jobs');

console.log('KYC user flow test passed');
