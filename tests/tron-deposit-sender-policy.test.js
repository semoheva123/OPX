// Deposits must never be refused because the sending wallet differs from the withdrawal wallet.
// A user may fund the shared deposit address from an exchange wallet, a second device, or any other
// wallet; the platform only records the sender and asks the finance team to review the difference.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deposits = require('../src/services/tronDepositService');
const blockchainService = require('../src/services/blockchainService');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const controller = read('src/controllers/walletController.js');
const service = read('src/services/tronDepositService.js');
const migration = read('supabase/shared-tron-deposit-txid.sql');

// --- static guarantees ---------------------------------------------------------------------------
assert.match(controller, /verifySharedDepositTransfer\(txHash, expectedAddress, senderAddress\)/, 'the controller must pass the pinned wallet for comparison only');
assert.doesNotMatch(controller, /TRON_DEPOSIT_SENDER_MISMATCH|SENDER_MISMATCH/, 'a different sender must never produce a rejection code');
assert.doesNotMatch(service, /throw new Error\('TRON_DEPOSIT_SENDER_MISMATCH'\)/, 'the verification service must not reject on a sender difference');
assert.match(service, /senderMatchesPinnedWallet/, 'the service must classify the sender instead of rejecting it');
assert.match(controller, /inspectDepositSender/, 'the controller must inspect the sender after crediting');
assert.match(controller, /deposit_sender_review/, 'a differing sender must be recorded for review');
assert.match(controller, /deposit_sender_recorded/, 'a matching or unknown sender must also be recorded');
assert.match(controller, /senderReview: \{ flagged: depositReview\.flagged/, 'the deposit response must report the review flag');
assert.match(migration, /from_address text not null/, 'the stored deposit event must keep the real sender address');

const originalFetch = global.fetch;
const originalDepositAddress = process.env.TRON_SHARED_DEPOSIT_ADDRESS;

(async () => {
  try {
    const depositAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
    const pinnedWallet = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
    const otherWallet = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb';
    process.env.TRON_SHARED_DEPOSIT_ADDRESS = depositAddress;
    const tokenContract = blockchainService.getBlockchainConfig().TRC20.tokenContract;
    const txHash = 'b'.repeat(64);

    const stubEvents = fromAddress => {
      global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data: [{
            transaction_id: txHash,
            event_name: 'Transfer',
            contract_address: tokenContract,
            result: { from: fromAddress, to: depositAddress, value: '25000000' },
            event_index: 0,
            block_timestamp: 1792100000000
          }]
        })
      });
    };

    // 1. A deposit from a completely different wallet is verified and credited, not rejected.
    stubEvents(otherWallet);
    const external = await deposits.verifySharedDepositTransfer(txHash, depositAddress, pinnedWallet);
    assert.equal(external.amount, '25');
    assert.equal(external.fromAddress, otherWallet, 'the real sender is preserved even when it differs');
    assert.equal(external.senderMatchesPinnedWallet, false, 'a difference is reported as data, not as an error');
    assert.equal(external.pinnedWalletAddress, pinnedWallet);

    // 2. An exchange-style deposit for a user who never pinned a withdrawal wallet still verifies.
    const withoutPinned = await deposits.verifySharedDepositTransfer(txHash, depositAddress);
    assert.equal(withoutPinned.senderMatchesPinnedWallet, null, 'a missing pinned wallet is unknown, not a failure');
    assert.equal(withoutPinned.amount, '25');

    // 3. A matching sender is reported as verified.
    stubEvents(pinnedWallet);
    const matching = await deposits.verifySharedDepositTransfer(txHash, depositAddress, pinnedWallet);
    assert.equal(matching.senderMatchesPinnedWallet, true);

    // 4. Multiple senders inside one transaction are surfaced, never blocked.
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        data: [
          { event_name: 'Transfer', contract_address: tokenContract, result: { from: otherWallet, to: depositAddress, value: '10000000' }, event_index: 0, block_timestamp: 1792100000000 },
          { event_name: 'Transfer', contract_address: tokenContract, result: { from: pinnedWallet, to: depositAddress, value: '15000000' }, event_index: 1, block_timestamp: 1792100000000 }
        ]
      })
    });
    const multi = await deposits.verifySharedDepositTransfer(txHash, depositAddress, pinnedWallet);
    assert.equal(multi.transferCount, 2);
    assert.equal(multi.amount, '25', 'all transfers to the deposit address are summed');
    assert.equal(multi.senderAddresses.length, 2, 'every sender is reported for review');

    console.log('TRON deposit sender policy tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    global.fetch = originalFetch;
    if (originalDepositAddress === undefined) delete process.env.TRON_SHARED_DEPOSIT_ADDRESS;
    else process.env.TRON_SHARED_DEPOSIT_ADDRESS = originalDepositAddress;
  }
})();
