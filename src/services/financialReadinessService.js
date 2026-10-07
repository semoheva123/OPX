const blockchainService = require('./blockchainService');
const tronProvider = require('./tronProvider');
const tronDepositService = require('./tronDepositService');
const { checkSupabaseConnection, supabaseAdmin } = require('../config/supabase');

async function checkFinancialReadiness() {
  const checks = {
    supabaseReachable: false,
    financialSchemaReady: false,
    noUnresolvedPayouts: false,
    depositXpubDerivesAddress: false,
    tronUsdtContractValid: false,
    payoutKeyConfigured: false,
    payoutKeyValid: false,
    payoutKeyFailure: null,
    tronProviderReachable: false,
    tronIndexerReachable: false,
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
  if (checks.supabaseReachable && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('withdrawal_payouts')
        .select('status,tx_hash')
        .in('status', ['preparing', 'broadcast', 'manual_review', 'failed'])
        .limit(1000);
      if (!error) {
        checks.noUnresolvedPayouts = !(data || []).some(row =>
          ['preparing', 'broadcast', 'manual_review'].includes(row.status) ||
          (row.status === 'failed' && Boolean(row.tx_hash))
        );
      }
    } catch {
      checks.noUnresolvedPayouts = false;
    }
  }

  try {
    checks.depositXpubDerivesAddress = Boolean(tronDepositService.deriveDepositAddress(0));
  } catch {
    checks.depositXpubDerivesAddress = false;
  }

  const config = blockchainService.getBlockchainConfig().TRC20;
  const privateKey = String(process.env.TRON_WITHDRAWAL_PRIVATE_KEY || '').trim();
  checks.payoutKeyConfigured = Boolean(privateKey);
  let readOnlyTronWeb;
  try {
    readOnlyTronWeb = tronProvider.createTronWeb();
    checks.tronUsdtContractValid = readOnlyTronWeb.isAddress(config.tokenContract);
  } catch {
    checks.tronUsdtContractValid = false;
  }

  try {
    const { body: block } = await tronProvider.requestJsonWithFallback(tronProvider.getRpcEndpoints(), 'wallet/getnowblock', {
      timeoutMs: 12000,
      request: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
    });
    checks.tronProviderReachable = Boolean(block.blockID || block.block_header?.raw_data?.number !== undefined);
  } catch {
    checks.tronProviderReachable = false;
  }

  try {
    const indexerPath = `v1/accounts/${encodeURIComponent(config.tokenContract)}/transactions/trc20?only_confirmed=true&contract_address=${encodeURIComponent(config.tokenContract)}&limit=1`;
    const { body: indexedTransfers } = await tronProvider.requestJsonWithFallback(tronProvider.getIndexerEndpoints(), indexerPath, {
      timeoutMs: 12000,
      validateBody: body => Array.isArray(body?.data)
    });
    checks.tronIndexerReachable = Array.isArray(indexedTransfers?.data);
  } catch {
    checks.tronIndexerReachable = false;
  }

  let tronWeb;
  if (!privateKey) {
    checks.payoutKeyFailure = 'missing';
  } else {
    try {
      tronWeb = tronProvider.createTronWeb({ privateKey });
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
      const [tokenBalance, trxBalance] = await Promise.all([
        tronProvider.withTronWeb(async client => {
          const token = await client.contract().at(config.tokenContract);
          return token.balanceOf(senderAddress).call();
        }, { endpoints: tronProvider.getRpcEndpoints(), privateKey }),
        tronProvider.withTronWeb(client => client.trx.getBalance(senderAddress), { endpoints: tronProvider.getRpcEndpoints(), privateKey })
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

  const readyForControlledTest = checks.supabaseReachable && checks.financialSchemaReady && checks.noUnresolvedPayouts &&
    checks.depositXpubDerivesAddress && checks.tronUsdtContractValid && (!switches.depositsEnabled || checks.tronIndexerReachable) && checks.payoutKeyConfigured &&
    checks.payoutKeyValid && checks.tronProviderReachable && checks.payoutBalancesReadable &&
    checks.payoutUsdtFunded && checks.payoutTrxSufficient;

  return { readyForControlledTest, checks, switches };
}

module.exports = { checkFinancialReadiness };
