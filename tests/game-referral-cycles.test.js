const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataAccess = require('../src/services/dataAccess');
const { calculateGameCycleGrant, syncGameCredits } = require('../src/services/gameAccess');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

assert.deepEqual(calculateGameCycleGrant(5, 6, 0), { entitledCycles: 0, newCycles: 0 });
assert.deepEqual(calculateGameCycleGrant(6, 6, 0), { entitledCycles: 1, newCycles: 1 });
assert.deepEqual(calculateGameCycleGrant(18, 6, 0), { entitledCycles: 3, newCycles: 3 });
assert.deepEqual(calculateGameCycleGrant(18, 6, 2), { entitledCycles: 3, newCycles: 1 });
assert.deepEqual(calculateGameCycleGrant(18, 6, 3), { entitledCycles: 3, newCycles: 0 });

const client = read('app.js');
const gameView = read('index.html');
const adminView = read('admin.html');
const server = read('server.js');
const schema = read('supabase/schema.sql');
assert.match(client, /referralsPerCycle:\s*6/);
assert.match(gameView, /6 إحالات نشطة = دورة/);
assert.match(adminView, /id="cfgReferralsPerCycle" value="6"/);
assert.match(server, /storedReferralThreshold === 25 \? 6/);
assert.match(schema, /referrals_per_cycle integer not null default 6/);

(async () => {
  const originalUpdateOne = dataAccess.user.updateOne;
  const persisted = [];
  dataAccess.user.updateOne = async (filter, changes) => {
    persisted.push({ filter, changes });
    return { modifiedCount: 1 };
  };

  try {
    const user = { id: 'test-user', gameCyclesGranted: 0, wheelCredits: 0, mysteryBoxCredits: 0 };
    const firstSync = await syncGameCredits(user, { referralsPerCycle: 6 }, 12);
    assert.deepEqual(firstSync, { activeReferrals: 12, newCycles: 2 });
    assert.equal(user.gameCyclesGranted, 2);
    assert.equal(user.wheelCredits, 2);
    assert.equal(user.mysteryBoxCredits, 2);
    assert.equal(persisted.length, 1, 'new paired game credits must be persisted');

    const secondSync = await syncGameCredits(user, { referralsPerCycle: 6 }, 12);
    assert.deepEqual(secondSync, { activeReferrals: 12, newCycles: 0 });
    assert.equal(persisted.length, 1, 'reloading the profile must not duplicate the same earned cycles');
    console.log('game referral cycles tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.user.updateOne = originalUpdateOne;
  }
})();
