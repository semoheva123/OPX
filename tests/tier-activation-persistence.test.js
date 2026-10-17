const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const app = read('app.js');
const userController = read('src/controllers/userController.js');
const publicController = read('src/controllers/publicController.js');
const activityController = read('src/controllers/activityController.js');
const migration = read('supabase/persistent-tier-activation.sql');
const productionSchema = read('supabase/production-readiness.sql');
const canonicalSchema = read('supabase/schema.sql');
const profileLoader = app.slice(app.indexOf('async function loadUserProfileInternal()'), app.indexOf('function onboardingState()'));

assert.match(migration, /add column if not exists tier_activated boolean not null default false/i);
assert.match(migration, /t\.type = 'upgrade_deduction'/, 'paid activations must backfill from approved upgrade records');
assert.match(migration, /upper\(coalesce\(u\.tier_code, 'A1'\)\) <> 'A1'/, 'legacy non-default tiers must remain activated');
assert.match(migration, /active_referrals_300_a4/, 'free A4 activations must be backfilled too');
assert.match(migration, /user_row\.tier_activated/i, 'the RPC must guard same-tier activation with the stored state');
assert.match(migration, /tier_activated = true/i, 'the RPC must persist successful activation');
assert.match(userController, /Boolean\(user\.tierActivated\)/, 'profile responses must use the persisted activation field');
assert.match(publicController, /user\.tierActivated/, 'server upgrade rules must use the persisted activation field');
assert.match(activityController, /user\.tierActivated/, 'paid features must honor persisted activation after reload');
assert.match(app, /data\.user\.tierActivated/, 'the client must restore activation from profile data');
assert.match(app, /currentUserTierActive = true/, 'successful upgrades must update activation immediately');
assert.match(profileLoader, /const maxTasksLabel = document\.getElementById\('lblMaxTasks'\);\s*if \(maxTasksLabel\) maxTasksLabel\.innerText = maxTasks;/, 'profile loading must tolerate the removed task-count label so tier cards still render');
assert.match(productionSchema, /tier_activated = true/i, 'the production RPC definition must persist activation');
assert.match(canonicalSchema, /tier_activated = true/i, 'the canonical schema RPC must persist activation');

console.log('Tier activation persistence tests passed');
