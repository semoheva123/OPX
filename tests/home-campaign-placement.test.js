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
assert.match(client, /if\s*\(tabName\s*===\s*'home'\)\s*\{\s*loadReferralRewardHistory\(\);/,
  'campaign totals and history must refresh when the home view opens');

console.log('Home campaign placement tests passed');
