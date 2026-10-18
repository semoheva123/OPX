const assert = require('node:assert/strict');
const { safeSocialName, socialNameFor, socialHandleFor } = require('../src/services/socialIdentity');

assert.equal(safeSocialName('member.name@gmail.com'), 'member.name');
assert.equal(safeSocialName('member.name'), 'member.name');
assert.equal(socialNameFor({ email: 'member.name@gmail.com', username: 'member.name@gmail.com' }), 'member.name');
assert.equal(socialHandleFor({ email: 'member.name@gmail.com', username: 'member.name@gmail.com' }), '@member.name');
assert.equal(socialNameFor({ email: 'official@operix.website', isOfficialPlatform: true }), 'OPERIX Official');
assert.equal(socialNameFor({ email: 'member@gmail.com', username: 'chosen-name' }), 'chosen-name');

console.log('social identity privacy tests: ok');