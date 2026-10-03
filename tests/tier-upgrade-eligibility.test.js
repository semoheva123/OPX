const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const publicController = read('src/controllers/publicController.js');
const client = read('app.js');

const upgradeHandler = publicController.slice(publicController.indexOf('async function upgradeSupabase'), publicController.indexOf('module.exports'));
const tierRenderer = client.slice(client.indexOf('function renderTiersList()'), client.indexOf('function updateTierDisplay()'));
const upgradeAction = client.slice(client.indexOf('async function upgradeToSpecificTier('), client.indexOf('function renderHomeSummaryFallback()'));

assert.doesNotMatch(upgradeHandler, /requiredReferrals|activeReferrals|targetIndex\s*>\s*currentIndex\s*\+\s*1/, 'backend tier upgrades must not require referrals or sequential activations');
assert.match(upgradeHandler, /const initialActivation = !currentActivated/, 'direct selection of any tier must be treated as first activation until an account is activated');
assert.match(upgradeHandler, /initialActivation\s*\?\s*Number\(targetLevel\.price\)/, 'first activation at a higher tier must charge that tier full price');
assert.doesNotMatch(tierRenderer, /requiredReferrals|referralsMet|activeReferrals\s*</, 'tier cards must not disable choices based on referral counts');
assert.match(tierRenderer, /tierIndex\s*>\s*currentIndex/, 'higher tiers must remain selectable without sequential referral prerequisites');
assert.doesNotMatch(upgradeAction, /يجب إكمال المستويات بالترتيب|إحالة نشطة إضافية/, 'client upgrade flow must not block users based on tier order or referral counts');

console.log('Tier upgrade eligibility tests passed');
