const { TronWeb } = require('tronweb');
const blockchainService = require('./blockchainService');
const tronDepositService = require('./tronDepositService');
const { checkSupabaseConnection } = require('../config/supabase');

async function checkFinancialReadiness() {
  const checks = {
    supabaseReachable: false,
    financialSchemaReady: false,
    depositXpubDerivesAddress: false,
    tronUsdtContractValid: false,
    payoutKeyConfigured: false,
    payoutKeyValid: false,
    payoutKeyFailure: null,
    tronProviderReachable: false,
    payoutBalancesReadable: false,
    payoutUsdtFunded: false,
    payoutTrxSufficient: false
  };
  const switches = {
    depositsEnabled: String(process.env.TRON_DEPOSIT_AUTOMATION_ENABLED || '').toLowerCase() === 'true',
    payoutsEnabled: String(process.env.WITHDRAWAL_PAYOUTS_ENABLED || '').toLowerCase() === 'true',
    autoApprovalEnabled: String(process.env.WITHDRAWAL_AUTO_APPROVAL_ENABLED || '').toLowerCase() === 'true'
  };

  const database = await checkSupabaseConnection().catch(() => null);
  checks.supabaseReachable = Boolean(database?.reachable);
  checks.financialSchemaReady = Boolean(database?.financialSchema?.ready);

  try {
    checks.depositXpubDerivesAddress = Boolean(tronDepositService.deriveDepositAddress(0));
  } catch {
    checks.depositXpubDerivesAddress = false;
  }

  const config = blockchainService.getBlockchainConfig().TRC20;
  const privateKey = String(process.env.TRON_WITHDRAWAL_PRIVATE_KEY || '').trim();
  checks.payoutKeyConfigured = Boolean(privateKey);
  const apiKey = String(process.env.TRONGRID_API_KEY || '').trim();
  const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};

  let readOnlyTronWeb;
  try {
    readOnlyTronWeb = new TronWeb({ fullHost: config.apiUrl, headers });
    checks.tronUsdtContractValid = readOnlyTronWeb.isAddress(config.tokenContract);
  } catch {
    checks.tronUsdtContractValid = false;
  }

  try {
    const response = await fetch(`${config.apiUrl}/wallet/getnowblock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: '{}',
      signal: AbortSignal.timeout(12000)
    });
    const block = await response.json().catch(() => ({}));
    checks.tronProviderReachable = response.ok && Boolean(block.blockID || block.block_header?.raw_data?.number !== undefined);
  } catch {
    checks.tronProviderReachable = false;
  }

  let tronWeb;
  if (!privateKey) {
    checks.payoutKeyFailure = 'missing';
  } else {
    try {
      tronWeb = new TronWeb({ fullHost: config.apiUrl, privateKey, headers });
      const derivedPayoutAddress = tronWeb.defaultAddress.base58;
      checks.payoutKeyValid = Boolean(derivedPayoutAddress && tronWeb.isAddress(derivedPayoutAddress));
      if (!checks.payoutKeyValid) checks.payoutKeyFailure = 'address_derivation_failed';
    } catch {
      checks.payoutKeyFailure = 'private_key_format_rejected';
    }
  }

  if (checks.payoutKeyValid && checks.tronUsdtContractValid && checks.tronProviderReachable) {
    try {
      const senderAddress = tronWeb.defaultAddress.base58;
      const token = await tronWeb.contract().at(config.tokenContract);
      const [tokenBalance, trxBalance] = await Promise.all([
        token.balanceOf(senderAddress).call(),
        tronWeb.trx.getBalance(senderAddress)
      ]);
      checks.payoutBalancesReadable = true;
      checks.payoutUsdtFunded = BigInt(String(tokenBalance)) > 0n;
      const feeLimit = BigInt(process.env.TRON_WITHDRAWAL_FEE_LIMIT_SUN || '100000000');
      const minTrx = BigInt(process.env.TRON_WITHDRAWAL_MIN_TRX_SUN || feeLimit.toString());
      checks.payoutTrxSufficient = BigInt(String(trxBalance)) >= (minTrx > feeLimit ? minTrx : feeLimit);
    } catch {
      checks.tronProviderReachable = false;
    }
  }

  const readyForControlledTest = checks.supabaseReachable && checks.financialSchemaReady &&
    checks.depositXpubDerivesAddress && checks.tronUsdtContractValid && checks.payoutKeyConfigured &&
    checks.payoutKeyValid && checks.tronProviderReachable && checks.payoutBalancesReadable &&
    checks.payoutUsdtFunded && checks.payoutTrxSufficient;

  return { readyForControlledTest, checks, switches };
}

module.exports = { checkFinancialReadiness };
