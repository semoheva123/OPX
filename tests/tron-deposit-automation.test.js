const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HDNodeWallet } = require('ethers');
const deposits = require('../src/services/tronDepositService');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const migration = read('supabase/automatic-trc20-deposits.sql');
const trc20Only = read('supabase/trc20-only-financials.sql');
const server = read('server.js');
const financialReadiness = read('src/services/financialReadinessService.js');
const queueWorkflow = read('.github/workflows/financial-queue-workers.yml');
const blockchainService = read('src/services/blockchainService.js');
const walletController = read('src/controllers/walletController.js');
const depositUi = read('index.html');

assert.match(migration, /create table if not exists public\.tron_deposit_addresses/i);
assert.match(migration, /create table if not exists public\.tron_deposit_events/i);
assert.match(migration, /operix_tron_deposit_credit_atomic/i);
assert.match(migration, /unique/i, 'deposit events must be idempotent');
assert.match(migration, /revoke all privileges.*anon.*authenticated/is);
assert.match(trc20Only, /TRC20_ONLY_SUPPORTED/);
assert.match(server, /process-tron-deposits/);
assert.match(server, /check-financial-readiness/);
assert.match(financialReadiness, /payoutUsdtFunded/);
assert.match(financialReadiness, /payoutTrxSufficient/);
assert.match(financialReadiness, /payoutBalancesReadable/);
assert.match(financialReadiness, /noUnresolvedPayouts/);
assert.match(financialReadiness, /payoutKeyFailure/);
assert.match(financialReadiness, /tronIndexerReachable/);
assert.match(financialReadiness, /getIndexerEndpoints/);
assert.doesNotMatch(financialReadiness, /sendRawTransaction|preparePayout|broadcastPreparedPayout/);
assert.match(queueWorkflow, /\/api\/internal\/cron\/process-tron-deposits/);
assert.doesNotMatch(blockchainService, /PLATFORM_(?:TRON|BSC)_DEPOSIT_ADDRESS|verifyDeposit|getDepositAddresses/);
assert.match(walletController, /return res\.status\(410\)/, 'manual TxHash deposits must remain disabled');
assert.doesNotMatch(depositUi, /handleDepositSubmit|depositTxHash|platformWalletAddress|copyPlatformWalletAddress/);
assert.match(depositUi, /userDepositAddress/);

const originalXpub = process.env.TRON_DEPOSIT_XPUB;
const originalEnabled = process.env.TRON_DEPOSIT_AUTOMATION_ENABLED;
(async () => {
  try {
    // Public ethers test mnemonic only; never use a test phrase for real deposits.
    const testMnemonic = 'test test test test test test test test test test test junk';
    const xpub = HDNodeWallet.fromPhrase(testMnemonic, undefined, "m/44'/195'/0'/0").neuter().extendedKey;
    process.env.TRON_DEPOSIT_XPUB = xpub;
    const address0 = deposits.deriveDepositAddress(0);
    const address1 = deposits.deriveDepositAddress(1);
    assert.match(address0, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    assert.match(address1, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    assert.notEqual(address0, address1, 'each child index must produce a different TRON deposit address');
    assert.throws(() => deposits.deriveDepositAddress(-1), /INVALID_TRON_DEPOSIT_DERIVATION_INDEX/);
    process.env.TRON_DEPOSIT_AUTOMATION_ENABLED = 'false';
    const disabled = await deposits.processTronDepositQueue();
    assert.equal(disabled.skipped, true, 'deposit scanning must remain disabled unless explicitly enabled');
    console.log('TRON deposit automation tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (originalXpub === undefined) delete process.env.TRON_DEPOSIT_XPUB;
    else process.env.TRON_DEPOSIT_XPUB = originalXpub;
    if (originalEnabled === undefined) delete process.env.TRON_DEPOSIT_AUTOMATION_ENABLED;
    else process.env.TRON_DEPOSIT_AUTOMATION_ENABLED = originalEnabled;
  }
})();
