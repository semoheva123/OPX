const assert = require('node:assert/strict');

process.env.EMAIL_FROM = 'OPERIX <verify@operix.website>';
const dataAccess = require('../src/services/dataAccess');
const deposits = require('../src/services/tronDepositService');

(async () => {
  const originalFindById = dataAccess.user.findById;
  try {
    const sent = [];
    dataAccess.user.findById = async userId => ({ id: userId, email: 'member@gmail.com', emailVerified: true });
    const result = await deposits.sendDepositConfirmationEmail({ emails: { send: async message => { sent.push(message); return { data: { id: 'resend-message-1' } }; } } }, 'user-1', {
      id: 'transaction-1',
      amount: '5.000000',
      txHash: 'a'.repeat(64),
      createdAt: '2026-10-08T12:00:00.000Z'
    });
    assert.deepEqual(result, { sent: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'member@gmail.com');
    assert.match(sent[0].subject, /تأكيد إيداع USDT/);
    assert.match(sent[0].html, /5 USDT/);
    assert.match(sent[0].html, /transaction-1/);
    assert.match(sent[0].html, new RegExp('a'.repeat(64)));

    dataAccess.user.findById = async userId => ({ id: userId, email: 'member@gmail.com', emailVerified: true });
    const failed = await deposits.sendDepositConfirmationEmail({ emails: { send: async () => { throw new Error('provider down'); } } }, 'user-1', {
      id: 'transaction-2', amount: '5', txHash: 'b'.repeat(64)
    });
    assert.deepEqual(failed, { sent: false, reason: 'EMAIL_DELIVERY_FAILED' }, 'email delivery failures must be contained after the ledger credit');

    dataAccess.user.findById = async userId => ({ id: userId, email: 'member@gmail.com', emailVerified: false });
    const unverified = await deposits.sendDepositConfirmationEmail({ emails: { send: async () => { throw new Error('should not send'); } } }, 'user-1', {
      id: 'transaction-3', amount: '5', txHash: 'c'.repeat(64)
    });
    assert.deepEqual(unverified, { sent: false, reason: 'VERIFIED_EMAIL_REQUIRED' });

    assert.equal(deposits.formatDepositReceiptAmount('5.000000'), '5');
    assert.equal(deposits.formatDepositReceiptAmount('5.230000'), '5.23');
    console.log('Deposit confirmation email tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.user.findById = originalFindById;
  }
})();
