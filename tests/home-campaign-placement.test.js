const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const homeStart = index.indexOf('<div id="view-home"');
const homeEnd = index.indexOf('<div id="socialUserCardModal"', homeStart);
const campaign = index.indexOf('<section class="home-referral-campaign');
const spinStart = index.indexOf('<div id="view-spin"');

assert.ok(homeStart >= 0 && homeEnd > homeStart, 'authenticated home view must exist');
assert.ok(campaign > homeStart && campaign < homeEnd, 'referral campaign must be inside the authenticated home view');
assert.ok(spinStart > homeEnd, 'campaign must not be nested in the hidden spin-game view');
assert.match(index, /home-campaign-prize-grid[\s\S]*?iPhone Duo[\s\S]*?Samsung Galaxy[\s\S]*?هاتف Xiaomi[\s\S]*?مكافآت مالية/,
  'authenticated home must show all campaign prize categories');
assert.match(index, /Apple-Foldable-iPhone-Plan[\s\S]*?loading="lazy"/,
  'phone prize images in the authenticated home should load lazily');
assert.match(index, /<details class="home-campaign-prizes">\s*<summary>/,
  'the detailed prize showcase should be collapsed by default to keep the home card compact');
assert.match(index, /box-sizing:\s*border-box;\s*min-height:\s*76px/,
  'the home reward metrics should use compact, padding-inclusive sizing');
assert.match(client, /if\s*\(tabName\s*===\s*'home'\)\s*\{\s*loadReferralRewardHistory\(\);/,
  'campaign totals and history must refresh when the home view opens');
assert.match(client, /campaignPointsByLevel\s*=\s*\{\s*1:\s*1,\s*2:\s*2,\s*3:\s*4\s*\}/,
  'campaign points must follow the published 1, 2, and 4 point levels');

console.log('Home campaign placement tests passed');
