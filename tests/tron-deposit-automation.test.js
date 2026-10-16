const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const server = read('server.js');
const depositService = read('src/services/tronDepositService.js');
const financialReadiness = read('src/services/financialReadinessService.js');
const queueWorkflow = read('.github/workflows/financial-queue-workers.yml');
const walletController = read('src/controllers/walletController.js');
const depositUi = read('index.html');

assert.doesNotMatch(server, /process-tron-deposits/);
assert.doesNotMatch(depositService, /processTronDepositQueue|processAddress|ensureUserDepositAddress/);
assert.match(depositService, /verifySharedDepositTransfer/);
assert.match(financialReadiness, /sharedDepositAddressConfigured/);
assert.match(financialReadiness, /payoutUsdtFunded/);
assert.match(financialReadiness, /payoutTrxSufficient/);
assert.doesNotMatch(financialReadiness, /nowPaymentsConfigured|depositXpubDerivesAddress|tronIndexerReachable/);
assert.doesNotMatch(queueWorkflow, /process-tron-deposits|NOWPAYMENTS_ONLY/);
assert.match(walletController, /verifySharedDepositTransfer\(txHash, expectedAddress, senderAddress\)/);
assert.match(walletController, /operix_shared_tron_deposit_credit_atomic/);
assert.match(depositUi, /id="sharedDepositTxHash"/);
assert.match(depositUi, /id="depositWalletQrCode"/);

console.log('TRON deposit automation retirement tests: ok');
