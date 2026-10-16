const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const publicController = read('src/controllers/publicController.js');
const client = read('app.js');
const productionMigration = read('supabase/production-readiness.sql');
const canonicalSchema = read('supabase/schema.sql');
const referralMigration = read('supabase/referral-cash-rewards.sql');
const fullPriceMigration = read('supabase/full-tier-upgrade-price.sql');

const referralMilestoneQuery = publicController.slice(publicController.indexOf('async function getActiveReferralMilestones'), publicController.indexOf('async function upgradeSupabase'));
const upgradeHandler = publicController.slice(publicController.indexOf('async function upgradeSupabase'), publicController.indexOf('module.exports'));
const tierRenderer = client.slice(client.indexOf('function renderTiersList()'), client.indexOf('function updateTierDisplay()'));
const upgradeAction = client.slice(client.indexOf('async function upgradeToSpecificTier('), client.indexOf('function renderHomeSummaryFallback()'));
const nextTierPanel = client.slice(client.indexOf('function updateNextTierPanel()'), client.indexOf('async function loadUpgradeHistory()'));

assert.match(referralMilestoneQuery, /select:\s*['"]id['"]/, 'referral milestone lookup must select users-table columns and rely on data access to attach wallets');
assert.doesNotMatch(referralMilestoneQuery, /select:\s*['"]wallet\.totalDeposits['"]/, 'wallet fields must not be selected as users-table columns in Supabase');
assert.doesNotMatch(upgradeHandler, /requiredReferrals|activeReferrals|targetIndex\s*>\s*currentIndex\s*\+\s*1/, 'backend tier upgrades must not require referrals or sequential activations');
assert.match(upgradeHandler, /const initialActivation = !currentActivated/, 'direct selection of any tier must be treated as first activation until an account is activated');
assert.match(upgradeHandler, /const upgradeCost = Number\(targetLevel\.price\)/, 'every paid upgrade must charge the full target-tier price');
assert.match(tierRenderer, /const cost = fullFeatureAccess \? 0 : isCurrent && currentActivated \? 0 : Number\(tier\.price \|\| 0\)/, 'tier cards must show the full target-tier price');
assert.match(nextTierPanel, /const cost = Number\(next\.price \|\| 0\)/, 'the next-tier panel must show the full tier price');
assert.match(upgradeAction, /const current = tiersData\.find\(tier => tier\.code === currentUserTier\)/, 'upgrade confirmation must retain the current tier activation check');
assert.match(upgradeAction, /const upgradeCost = fullFeatureAccess \? 0 : Number\(target\.price \|\| 0\)/, 'the payment confirmation must use the full target-tier price');
assert.match(productionMigration, /expected_upgrade_cost := target_level\.price;/, 'the production RPC must require the full target-tier price');
assert.doesNotMatch(productionMigration, /when wallet_row\.total_deposits > 0 then greatest\(target_level\.price - coalesce\(current_level\.price, 0\), 0\)/, 'the production RPC must not subtract the current tier price');
assert.match(fullPriceMigration, /pg_get_functiondef\(function_signature\)/, 'the focused production migration must preserve the installed function body');
assert.match(fullPriceMigration, /expected_upgrade_cost := target_level\.price;/, 'the focused production migration must set the full target-tier price');
assert.match(canonicalSchema, /abs\(p_upgrade_cost - expected_upgrade_cost\) > 0\.01/, 'the canonical RPC must validate the full target-tier price');
assert.match(referralMigration, /abs\(p_upgrade_cost - target_level_price\) > 0\.01/, 'the referral migration must retain the full-price validation');
assert.doesNotMatch(tierRenderer, /requiredReferrals|referralsMet|activeReferrals\s*</, 'tier cards must not disable choices based on referral counts');
assert.match(tierRenderer, /tierIndex\s*>\s*currentIndex/, 'higher tiers must remain selectable without sequential referral prerequisites');
assert.doesNotMatch(upgradeAction, /يجب إكمال المستويات بالترتيب|إحالة نشطة إضافية/, 'client upgrade flow must not block users based on tier order or referral counts');

console.log('Tier upgrade eligibility tests passed');
