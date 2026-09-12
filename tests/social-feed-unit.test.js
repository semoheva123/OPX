const assert = require('node:assert/strict');
const { moderateText } = require('../src/services/socialSafetyBot');
const supportController = require('../src/controllers/supportController');
const dataAccess = require('../src/services/dataAccess');
const realtimeService = require('../src/services/realtimeService');

assert.equal(moderateText('نصيحة عن أمان المحافظ').status, 'visible');
assert.equal(moderateText('هذا scam واضح').status, 'banned');
assert.equal(moderateText('not paying').status, 'banned');
assert.equal(moderateText('راحت فلوسي').status, 'banned');
assert.equal(moderateText('محتوى تعليمي للمجتمع').allowed, true);

(async () => {
  let notificationPayload = null;
  const originalFindOne = dataAccess.supportTicket.findOne;
  const originalUpdateOne = dataAccess.supportTicket.updateOne;
  const originalCreate = dataAccess.notification.create;
  const originalEmit = realtimeService.emit;

  try {
    dataAccess.supportTicket.findOne = async () => ({ id: 't1', userId: 'u1', status: 'open', message: 'existing' });
    dataAccess.supportTicket.updateOne = async () => ({ success: true });
    dataAccess.notification.create = async (doc) => {
      notificationPayload = doc;
      return { id: 'n1', ...doc };
    };
    realtimeService.emit = () => {};

    await supportController.updateAdmin({
      params: { id: 't1' },
      body: { status: 'closed' }
    }, {
      status(code) { return this; },
      json(payload) { this.payload = payload; }
    });

    assert.ok(notificationPayload, 'notification should be created when admin only changes ticket status');
    assert.equal(notificationPayload.title, 'تم تحديث تذكرة الدعم');
    assert.equal(notificationPayload.body, 'تم تحديث تذكرة الدعم إلى closed');
    assert.equal(notificationPayload.type, 'support');
  } finally {
    dataAccess.supportTicket.findOne = originalFindOne;
    dataAccess.supportTicket.updateOne = originalUpdateOne;
    dataAccess.notification.create = originalCreate;
    realtimeService.emit = originalEmit;
  }
})();

console.log('social feed moderation tests: ok');
