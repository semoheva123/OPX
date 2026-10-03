const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const client = read('app.js');
const index = read('index.html');
const userController = read('src/controllers/userController.js');

for (const level of [1, 2, 3]) {
  for (const status of ['Active', 'Inactive']) {
    const counterId = `lblTeamLevel${level}${status}Count`;
    const statsKey = `l${level}${status}`;
    assert.ok(index.includes(`id="${counterId}"`), `team view must render the ${status.toLowerCase()} count for level ${level}`);
    assert.ok(client.includes(`['${counterId}', stats.${statsKey}]`), `profile stats must update the ${status.toLowerCase()} count for level ${level}`);
    assert.ok(userController.includes(`${statsKey}: levelCounts[${level - 1}].${status.toLowerCase()}`), `profile API must provide the ${status.toLowerCase()} count for level ${level}`);
  }
}

assert.ok(index.includes('id="teamReferralMilestoneCount"'), 'team view must show progress toward 300 active referrals');
assert.ok(index.includes('aria-valuemax="300"'), 'team milestone progress bar must use the 300-referral target');
assert.ok(client.includes('const milestoneTarget = 300;'), 'team progress must use the 300-referral milestone');
assert.ok(client.includes('Number(stats.activeReferrals)'), 'team progress must use the active-referral count');
assert.ok(client.includes('teamReferralMilestoneStatus'), 'team view must show the remaining count or qualification status');

console.log('team member count tests: ok');
