const assert = require('assert');
const { getTierDailyOpxConversion } = require('../src/services/opxPricing');

const expected = {
  A1: 0.05,
  A2: 0.10,
  A3: 0.15,
  A4: 0,
  A5: 0,
  UNKNOWN: 0
};

for (const [tierCode, expectedValue] of Object.entries(expected)) {
  const actual = getTierDailyOpxConversion(tierCode);
  assert.strictEqual(actual, expectedValue, `Tier ${tierCode} should convert ${expectedValue} USD to OPX daily`);
}

console.log('tier daily OPX conversion tests: ok');
