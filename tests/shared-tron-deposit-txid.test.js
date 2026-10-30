const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deposits = require('../src/services/tronDepositService');
const blockchainService = require('../src/services/blockchainService');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const controller = read('src/controllers/walletController.js');
const routes = read('src/routes/walletRoutes.js');
const migration = read('supabase/shared-tron-deposit-txid.sql');
const ui = read('index.html');
const app = read('app.js');

assert.match(routes, /wallet\/deposit-config/);
assert.match(routes, /router\.post\('\/wallet\/deposit',\s*verifyToken/);
assert.doesNotMatch(routes, /nowpayments/i);
assert.match(controller, /verifySharedDepositTransfer\(txHash, expectedAddress, senderAddress\)/);
assert.doesNotMatch(controller, /TRON_DEPOSIT_SENDER_MISMATCH/);
assert.match(controller, /operix_shared_tron_deposit_credit_atomic/);
assert.match(controller, /p_tx_hash: transfer\.txHash/);
assert.match(migration, /shared_tron_deposit_events/);
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(normalized_hash, 0\)\)/);
assert.match(migration, /shared_tron_txid_deposit/);
assert.match(migration, /revoke all privileges.*anon, authenticated/is);
assert.match(migration, /grant execute on function.*to service_role/is);
assert.match(ui, /id="depositWalletQrCode"/);
assert.match(ui, /id="sharedDepositTxHash"/);
assert.match(ui, /id="sharedDepositClaimButton"/);
assert.match(app, /fetch\('\/api\/wallet\/deposit-config'/);
assert.doesNotMatch(app, /nowpayments/i);

const originalFetch = global.fetch;
const originalDepositAddress = process.env.TRON_SHARED_DEPOSIT_ADDRESS;

(async () => {
  try {
    const walletAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
    process.env.TRON_SHARED_DEPOSIT_ADDRESS = walletAddress;
    assert.equal(deposits.getSharedDepositAddress(), walletAddress);

    const txHash = 'a'.repeat(64);
    const tokenContract = blockchainService.getBlockchainConfig().TRC20.tokenContract;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        data: [{
          transaction_id: txHash,
          event_name: 'Transfer',
          contract_address: tokenContract,
          result: { from: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', to: walletAddress, value: '10000000' },
          event_index: 2,
          block_timestamp: 1792100000000
        }]
      })
    });
    const verified = await deposits.verifySharedDepositTransfer(txHash, walletAddress);
    assert.equal(verified.txHash, txHash);
    assert.equal(verified.amount, '10');
    assert.equal(verified.toAddress, walletAddress);
    assert.equal(verified.fromAddress, 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 'a deposit from a wallet different from the withdrawal wallet remains valid');
    assert.equal(verified.eventIndex, 2);

    await assert.rejects(() => deposits.verifySharedDepositTransfer('invalid', walletAddress), /INVALID_TRON_DEPOSIT_TX_HASH/);

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: [{
        event_name: 'Transfer',
        contract_address: tokenContract,
        result: { from: walletAddress, to: walletAddress, value: '10000001' },
        event_index: 0,
        block_timestamp: 1792100000000
      }] })
    });
    await assert.rejects(() => deposits.verifySharedDepositTransfer(txHash, walletAddress), /TRON_DEPOSIT_PRECISION_UNSUPPORTED/);
    console.log('Shared TRON TxID deposit tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    global.fetch = originalFetch;
    if (originalDepositAddress === undefined) delete process.env.TRON_SHARED_DEPOSIT_ADDRESS;
    else process.env.TRON_SHARED_DEPOSIT_ADDRESS = originalDepositAddress;
  }
})();
