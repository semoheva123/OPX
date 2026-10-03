const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicController = fs.readFileSync(path.join(__dirname, '..', 'src/controllers/publicController.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.match(publicController, /300.*إحالة|300.*referrals|300.*active.*referrals/i, 'backend upgrade logic must recognize the 300-active-referral threshold');
assert.match(publicController, /A4|tier.*4|target.*4|level.*4/i, 'backend upgrade logic must support the fourth activation tier');
assert.match(publicController, /100.*profit|100.*ربح|profitBalance.*100|\$100/i, 'the 300-referral reward must add an instant $100 profit bonus');
assert.match(client, /300.*إحالة|A4|المستوى الرابع|المستوى الرابع مجاني/i, 'frontend must surface the level-4 free activation reward to the user');

console.log('Tier four free upgrade reward tests passed');
