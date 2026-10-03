const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const schema = read('supabase/schema.sql');
const migration = read('supabase/referral-campaign-points.sql');
const correction = read('supabase/referral-campaign-points-v2.sql');
const publicController = read('src/controllers/publicController.js');
const userController = read('src/controllers/userController.js');
const userRoutes = read('src/routes/userRoutes.js');
const publicRoutes = read('src/routes/publicRoutes.js');
const client = read('app.js');
const index = read('index.html');

for (const source of [schema, migration]) {
  assert.match(source, /campaign_points\s+integer\s+not null\s+default\s+0/i, 'users must persist the campaign points balance');
  assert.match(source, /unique\s*\(referred_user_id,\s*level_number\)/i, 'each referred account can award a level only once');
  assert.match(source, /case\s+target_level_number\s+when\s+1\s+then\s+1\s+when\s+2\s+then\s+2\s+when\s+3\s+then\s+4/i, 'the first three levels must award 1, 2, and 4 points');
  assert.match(source, /on conflict\s*\(referred_user_id,level_number\)\s+do nothing/i, 'retries must not duplicate a point award');
  assert.match(source, /campaign_points\s*=\s*campaign_points\s*\+\s*points_awarded/i, 'new awards must increment the inviter balance atomically');
}

assert.match(publicController, /campaignLeaderboard/, 'public controller must provide a points leaderboard');
assert.match(publicController, /campaignPointsAwarded/, 'upgrade response must report points awarded for the referral');
assert.match(userController, /getCampaignPoints/, 'users must be able to retrieve their own award history');
assert.match(userRoutes, /\/campaign-points/, 'authenticated point-history endpoint must be registered');
assert.match(publicRoutes, /\/campaign\/leaderboard/, 'public campaign leaderboard endpoint must be registered');
assert.match(correction, /level_number\s*=\s*1\s+and\s+points\s*=\s*2/i, 'the correction migration must find old level-one awards');
assert.match(correction, /level_number\s*=\s*2\s+and\s+points\s*=\s*3/i, 'the correction migration must find old level-two awards');
assert.match(correction, /level_number\s*=\s*3\s+and\s+points\s*=\s*5/i, 'the correction migration must find old level-three awards');
assert.match(correction, /campaign_points\s*=\s*users\.campaign_points\s*\+\s*point_deltas\.delta/i, 'the correction must reconcile inviter balances');
assert.match(client, /loadCampaignPointHistory/, 'team view must load the signed-in user point history');
assert.match(client, /loadCampaignLeaderboard/, 'guest page must be able to load the leaderboard');
assert.match(index, /campaignPointsBalance/, 'team view must display the point balance');

console.log('Referral campaign points tests passed');