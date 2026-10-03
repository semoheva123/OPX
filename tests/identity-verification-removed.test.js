const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const userControllerSource = read('src/controllers/userController.js');
const userRoutesSource = read('src/routes/userRoutes.js');
const adminControllerSource = read('src/controllers/adminController.js');
const adminRoutesSource = read('src/routes/adminRoutes.js');

assert.doesNotMatch(userControllerSource, /submitKyc/i, 'identity submission handler should be removed');
assert.doesNotMatch(userRoutesSource, /kyc/i, 'user routes should not expose identity-verification endpoints');
assert.doesNotMatch(adminControllerSource, /reviewUserKyc|streamKycDocument|kycSummary|complianceReport/i, 'identity review and report handlers should be removed');
assert.doesNotMatch(adminRoutesSource, /kyc|compliance-report/i, 'admin routes should not expose identity-verification endpoints');
assert.equal(fs.existsSync(path.join(__dirname, '../src/services/kycStorage.js')), false, 'identity document storage service should be removed');

const walletControllerSource = read('src/controllers/walletController.js');
assert.doesNotMatch(walletControllerSource, /kycStatus/i, 'withdrawals should not depend on identity-verification status');
assert.match(walletControllerSource, /riskScore/, 'withdrawal risk scoring should remain enabled');
assert.match(walletControllerSource, /riskFlags/, 'withdrawal risk flags should remain enabled');

const appSource = read('app.js');
assert.doesNotMatch(appSource, /kycStatus|submitUserKyc|توثيق الهوية/i, 'user interface should not show identity-verification prompts');
const indexSource = read('index.html');
assert.doesNotMatch(indexSource, /kyc|توثيق الهوية/i, 'profile should not contain identity-verification controls');
const adminSource = read('admin.html');
assert.doesNotMatch(adminSource, /kyc|توثيق الهوية/i, 'admin UI should not contain identity-review controls');

console.log('Identity verification removal test passed');