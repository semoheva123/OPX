const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const migration = read('supabase/production-readiness.sql');
const canonicalSchema = read('supabase/schema.sql');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');
const controller = read('src/controllers/publicController.js');
const dataAccess = read('src/services/dataAccess.js');
const validator = read('scripts/validate-supabase-readiness.js');
const supabaseConfig = read('src/config/supabase.js');
const app = read('src/app.js');

for (const table of [
  'daily_task_entities',
  'daily_task_assignments',
  'daily_task_submissions',
  'daily_task_completions',
  'referral_reward_awards',
  'milestone_reward_awards'
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'), `${table} must be provisioned`);
}

assert.match(migration, /referrals_per_cycle\)\s*values\s*\('default',\s*6\)/i, 'game cycle threshold must be six');
assert.match(migration, /length\(trim\(submission\.feedback\)\) between 10 and 500/i, 'database and app evaluation note limits must agree');
for (const source of [migration, canonicalSchema]) {
  assert.match(source, /'technology',\s*'ai',\s*'crypto',\s*'trading',\s*'finance'/i, 'all generated task categories must pass database constraints');
}
assert.match(migration, /active_referrals_count\s*<\s*300/i, 'A4 eligibility must be verified in SQL');
assert.match(migration, /unique\(user_id, milestone_key\)/i, 'the milestone reward must be one-time per user');
assert.match(migration, /instantProfitReward/i, 'the atomic upgrade RPC must return the awarded bonus');
assert.match(migration, /referral_milestone/i, 'the A4 bonus must be recorded in the financial ledger');
assert.match(migration, /enable row level security/i, 'RLS must be enabled on all public tables');
assert.match(migration, /revoke all privileges on table .* from public, anon, authenticated/i, 'direct client access must be revoked');
assert.match(migration, /grant all privileges on table .* to service_role/i, 'the backend service role must retain table access');

const upgradeBody = controller.slice(controller.indexOf('async function upgradeSupabase'), controller.indexOf('module.exports'));
assert.match(upgradeBody, /milestoneRewardAward\.findOne/, 'the app must avoid requesting an already-awarded milestone');
assert.match(upgradeBody, /result\.instantProfitReward/, 'the app must use the database-committed milestone reward');
assert.doesNotMatch(upgradeBody, /dataAccess\.user\.updateOne/, 'the app must not credit the milestone outside the atomic RPC');
assert.match(dataAccess, /MilestoneRewardAward: \{ table: 'milestone_reward_awards' \}/);
assert.match(validator, /daily_task_entities/);
assert.match(validator, /milestone_reward_awards/);
for (const table of ['tron_deposit_addresses', 'tron_deposit_address_sequences', 'tron_deposit_events', 'withdrawal_payouts']) {
  assert.ok(validator.includes(`'${table}'`), `${table} must be checked by the production readiness validator`);
  assert.match(supabaseConfig, new RegExp(`'${table}'`), `${table} must be probed by production health`);
}
assert.match(supabaseConfig, /depositTablesReady/);
assert.match(supabaseConfig, /payoutTableReady/);
assert.match(app, /financialSchema: supabase\?\.financialSchema/);
assert.match(sitemap, /<loc>https:\/\/operix\.website\//);
assert.doesNotMatch(sitemap, /localhost|127\.0\.0\.1/);
assert.match(robots, /Sitemap: https:\/\/operix\.website\/sitemap\.xml/);
assert.doesNotMatch(robots, /localhost|127\.0\.0\.1/);

console.log('Supabase production readiness tests: ok');
