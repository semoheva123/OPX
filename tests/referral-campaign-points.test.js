const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const schema = read('supabase/schema.sql');
const migration = read('supabase/referral-cash-rewards.sql');
const publicController = read('src/controllers/publicController.js');
const userController = read('src/controllers/userController.js');
const userRoutes = read('src/routes/userRoutes.js');
const client = read('app.js');
const index = read('index.html');

for (const source of [schema, migration]) {
  assert.match(source, /referral_reward_awards/i, 'the database must track direct-referral cash rewards');
  assert.match(source, /unique\s*\(referred_user_id,\s*level_number\)/i, 'each referred account can award a level only once');
  assert.match(source, /when\s+1\s+then\s+1\s+when\s+2\s+then\s+2\s+when\s+3\s+then\s+5/i, 'the first three levels must award $1, $2, and $5');
  assert.match(source, /on conflict\s*\(referred_user_id,level_number\)\s+do nothing/i, 'retries must not duplicate a referral reward');
  assert.match(source, /profit_balance\s*=\s*profit_balance\s*\+\s*(?:reward_awarded|referral_reward_awarded)/i, 'new rewards must add cash to the inviter profit balance atomically');
}

assert.match(publicController, /referralRewardAwarded/, 'upgrade response must report the direct-referral reward earned');
assert.match(userController, /getReferralRewards/, 'users must be able to retrieve their own reward history');
assert.match(userRoutes, /\/referral-rewards/, 'authenticated reward-history endpoint must be registered');
assert.match(client, /loadReferralRewardHistory/, 'team view must load the signed-in referral reward history');
assert.match(index, /referralRewardsTotal/, 'team view must display the direct-referral total');
assert.match(index, /\+\$1|\+\$2|\+\$5/i, 'the team view must list the updated reward values');

console.log('Referral reward tests passed');