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
const userController = require('../src/controllers/publicController');
const dataAccess = require('../src/services/dataAccess');

const referralMilestoneQuery = publicController.slice(publicController.indexOf('async function getActiveReferralMilestones'), publicController.indexOf('async function upgradeSupabase'));
const upgradeHandler = publicController.slice(publicController.indexOf('async function upgradeSupabase'), publicController.indexOf('module.exports'));
const tierRenderer = client.slice(client.indexOf('function renderTiersList()'), client.indexOf('function updateTierDisplay()'));
const upgradeAction = client.slice(client.indexOf('async function upgradeToSpecificTier('), client.indexOf('function renderHomeSummaryFallback()'));
const nextTierPanel = client.slice(client.indexOf('function updateNextTierPanel()'), client.indexOf('async function loadUpgradeHistory()'));

assert.match(referralMilestoneQuery, /select:\s*['"]id['"]/, 'referral milestone lookup must select users-table columns and rely on data access to attach wallets');
assert.doesNotMatch(referralMilestoneQuery, /select:\s*['"]wallet\.totalDeposits['"]/, 'wallet fields must not be selected as users-table columns in Supabase');
assert.doesNotMatch(upgradeHandler, /requiredReferrals|activeReferrals|targetIndex\s*>\s*currentIndex\s*\+\s*1/, 'backend tier upgrades must not require referrals or sequential activations');
assert.match(upgradeHandler, /const initialActivation = !currentActivated/, 'direct selection of any tier must be treated as first activation until an account is activated');
assert.match(upgradeHandler, /currentActivated = Boolean\(currentLevel && \([\s\S]*?user\.tierCode \|\| 'A1'[\s\S]*?totalDeposits/, 'saved non-default tiers must block repeating activation when deposit totals are zero');
assert.match(upgradeHandler, /const upgradeCost = Number\(targetLevel\.price\)/, 'every paid upgrade must charge the full target-tier price');
assert.match(tierRenderer, /Boolean\(currentUserData\?\.isTierActivated/, 'tier status must use the activation flag loaded from the profile');
assert.match(tierRenderer, /currentUserData\?\.tierActivated/, 'tier status must accept the legacy activation flag name');
assert.match(tierRenderer, /const cost = fullFeatureAccess \? 0 : isCurrent && currentActivated \? 0 : Number\(tier\.price \|\| 0\)/, 'tier cards must show the full target-tier price');
assert.match(nextTierPanel, /const cost = Number\(next\.price \|\| 0\)/, 'the next-tier panel must show the full tier price');
assert.match(upgradeAction, /const current = tiersData\.find\(tier => tier\.code === currentUserTier\)/, 'upgrade confirmation must retain the current tier activation check');
assert.match(upgradeAction, /const upgradeCost = fullFeatureAccess \? 0 : Number\(target\.price \|\| 0\)/, 'the payment confirmation must use the full target-tier price');
assert.match(upgradeAction, /Boolean\(current && \(currentUserData\?\.isTierActivated/, 'upgrade confirmation must respect persisted activation after reload');
assert.match(productionMigration, /expected_upgrade_cost := target_level\.price;/, 'the production RPC must require the full target-tier price');
assert.doesNotMatch(productionMigration, /when wallet_row\.total_deposits > 0 then greatest\(target_level\.price - coalesce\(current_level\.price, 0\), 0\)/, 'the production RPC must not subtract the current tier price');
assert.match(fullPriceMigration, /pg_get_functiondef\(function_signature\)/, 'the focused production migration must preserve the installed function body');
assert.match(fullPriceMigration, /expected_upgrade_cost := target_level\.price;/, 'the focused production migration must set the full target-tier price');
assert.match(canonicalSchema, /abs\(p_upgrade_cost - expected_upgrade_cost\) > 0\.01/, 'the canonical RPC must validate the full target-tier price');
assert.match(referralMigration, /abs\(p_upgrade_cost - target_level_price\) > 0\.01/, 'the referral migration must retain the full-price validation');
assert.doesNotMatch(tierRenderer, /requiredReferrals|referralsMet|activeReferrals\s*</, 'tier cards must not disable choices based on referral counts');
assert.match(tierRenderer, /tierIndex\s*>\s*currentIndex/, 'higher tiers must remain selectable without sequential referral prerequisites');
assert.doesNotMatch(upgradeAction, /يجب إكمال المستويات بالترتيب|إحالة نشطة إضافية/, 'client upgrade flow must not block users based on tier order or referral counts');
assert.match(upgradeAction, /currentUserTierActive = true/, 'successful activations must update the current-tier UI immediately');

const originals = {
	userFindById: dataAccess.user.findById,
	userFind: dataAccess.user.find,
	vipLevelFind: dataAccess.vipLevel.find,
	upgradeExists: dataAccess.transaction.exists,
	milestoneFindOne: dataAccess.milestoneRewardAward.findOne,
	rpc: dataAccess.callSupabaseRpc
};

(async () => {
	try {
		dataAccess.user.findById = async () => ({
			id: 'already-activated-user',
			email: 'member@example.test',
			tierCode: 'A4',
			wallet: { totalDeposits: 0, depositBalance: 0, profitBalance: 100 }
		});
		dataAccess.user.find = async () => [];
		dataAccess.vipLevel.find = async () => [
			{ code: 'A1', name: 'A1', price: 100 },
			{ code: 'A4', name: 'A4', price: 800 }
		];
		dataAccess.transaction.exists = async query => query.type === 'upgrade_deduction' && query.status.$in.includes('approved');
		dataAccess.milestoneRewardAward.findOne = async () => ({ id: 'milestone-awarded' });
		dataAccess.callSupabaseRpc = async () => { throw new Error('RPC must not be called for duplicate same-tier activation'); };

		const response = {
			statusCode: 200,
			body: null,
			status(code) { this.statusCode = code; return this; },
			json(body) { this.body = body; return this; }
		};
		await userController.upgrade({ user: { id: 'already-activated-user' }, body: { targetTier: 'A4' } }, response);
		assert.equal(response.statusCode, 400, 'a recorded A4 activation with zero deposits must not be charged again');
		assert.match(response.body.error, /الترقية فقط/);
		console.log('Tier upgrade eligibility and persisted activation tests passed');
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	} finally {
		dataAccess.user.findById = originals.userFindById;
		dataAccess.user.find = originals.userFind;
		dataAccess.vipLevel.find = originals.vipLevelFind;
		dataAccess.transaction.exists = originals.upgradeExists;
		dataAccess.milestoneRewardAward.findOne = originals.milestoneFindOne;
		dataAccess.callSupabaseRpc = originals.rpc;
	}
})();
