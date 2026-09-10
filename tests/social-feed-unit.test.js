const assert = require('node:assert/strict');
const { moderateText } = require('../src/services/socialSafetyBot');

assert.equal(moderateText('نصيحة عن أمان المحافظ').status, 'visible');
assert.equal(moderateText('هذا scam واضح').status, 'banned');
assert.equal(moderateText('not paying').status, 'banned');
assert.equal(moderateText('راحت فلوسي').status, 'banned');
assert.equal(moderateText('محتوى تعليمي للمجتمع').allowed, true);

console.log('social feed moderation tests: ok');
