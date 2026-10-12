const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const modalStart = index.indexOf('id="rewardsCampaignModal"');
const modalEnd = index.indexOf('<!-- 7. التوست التنبيهي', modalStart);
const modal = index.slice(modalStart, modalEnd);

assert.ok(modalStart >= 0 && modalEnd > modalStart, 'campaign modal must exist');
assert.match(modal, /الحملة جارية الآن/, 'modal must visibly identify the campaign as active');
assert.equal((modal.match(/<article class="reward-prize-card/g) || []).length, 4, 'modal must show all four prize cards');
assert.match(modal, /aria-label="إغلاق نافذة حملة النقاط والمكافآت"/, 'modal must offer an accessible close button');
assert.match(client, /showRewardsCampaignModal\(true\);\s*loadUserProfile\(\);/, 'successful login must always show the campaign');
assert.match(client, /showRewardsCampaignModal\(\);\s*maybeShowOnboarding\(\);/, 'restored authenticated visits must show the campaign');
assert.match(client, /sessionStorage\.getItem\('operix_rewards_campaign_seen'\)/, 'campaign should not reopen repeatedly during the same browsing session');
assert.match(client, /function closeRewardsCampaignModal\(\)/, 'campaign modal must be dismissible');

console.log('Rewards campaign popup tests passed');
