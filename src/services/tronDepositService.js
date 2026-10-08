const { HDNodeWallet, computeAddress } = require('ethers');
const blockchainService = require('./blockchainService');
const tronProvider = require('./tronProvider');
const dataAccess = require('./dataAccess');
const realtimeService = require('./realtimeService');
const { depositConfirmedTemplate } = require('./emailTemplates');

const TRON_DECIMALS = 6;
const LOOKBACK_MS = 2 * 60 * 1000;
const PAGE_SIZE = 200;
const MAX_PAGES_PER_ADDRESS = 10;
const emailFrom = String(process.env.EMAIL_FROM || '').trim();

function getTronWeb() {
  return tronProvider.createTronWeb();
}

function getLocalTronWeb() {
  return tronProvider.createTronWebForEndpoint('http://127.0.0.1');
}

function normalizeTronAddress(value, tronWeb = getLocalTronWeb()) {
  if (!value) return '';
  try {
    return String(tronWeb.address.toHex(String(value).trim())).replace(/^0x/i, '').toLowerCase();
  } catch {
    return '';
  }
}

function deriveDepositAddress(derivationIndex) {
  const extendedPublicKey = String(process.env.TRON_DEPOSIT_XPUB || '').trim();
  if (!extendedPublicKey) throw new Error('TRON_DEPOSIT_XPUB_NOT_CONFIGURED');
  const index = Number(derivationIndex);
  if (!Number.isSafeInteger(index) || index < 0 || index > 0x7fffffff) throw new Error('INVALID_TRON_DEPOSIT_DERIVATION_INDEX');
  const accountNode = HDNodeWallet.fromExtendedKey(extendedPublicKey);
  const child = accountNode.deriveChild(index);
  const ethereumAddress = computeAddress(child.publicKey);
  const tronWeb = getLocalTronWeb();
  const tronAddress = tronWeb.address.fromHex(`41${ethereumAddress.slice(2)}`);
  if (!tronWeb.isAddress(tronAddress)) throw new Error('DERIVED_TRON_DEPOSIT_ADDRESS_INVALID');
  return tronAddress;
}

async function ensureUserDepositAddress(userId) {
  if (!dataAccess.isSupabaseRuntime()) throw new Error('TRON_DEPOSIT_AUTOMATION_REQUIRES_SUPABASE');
  const reservation = await dataAccess.callSupabaseRpc('operix_tron_deposit_address_reserve_atomic', { p_user_id: userId });
  if (!reservation?.derivationIndex && reservation?.derivationIndex !== 0) throw new Error('TRON_DEPOSIT_ADDRESS_RESERVATION_FAILED');
  if (reservation.address) return reservation.address;
  const address = deriveDepositAddress(reservation.derivationIndex);
  const assigned = await dataAccess.callSupabaseRpc('operix_tron_deposit_address_assign_atomic', {
    p_user_id: userId,
    p_derivation_index: reservation.derivationIndex,
    p_address: address
  });
  if (!assigned?.address) throw new Error('TRON_DEPOSIT_ADDRESS_ASSIGNMENT_FAILED');
  return assigned.address;
}

function formatUsdt(rawAmount) {
  const units = BigInt(String(rawAmount));
  const whole = units / 10n ** BigInt(TRON_DECIMALS);
  const fractional = String(units % 10n ** BigInt(TRON_DECIMALS)).padStart(TRON_DECIMALS, '0').replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : String(whole);
}

async function fetchTronGrid(path) {
  const result = await tronProvider.requestJsonWithFallback(tronProvider.getIndexerEndpoints(), path, {
    timeoutMs: 12000,
    validateBody: body => Array.isArray(body?.data)
  });
  return result.body;
}

function formatDepositReceiptAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return amount.toFixed(6).replace(/\.?0+$/, '');
}

async function sendDepositConfirmationEmail(resend, userId, transaction) {
  if (!resend?.emails?.send || !emailFrom || !transaction?.id || !transaction?.txHash) return { sent: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  try {
    const user = await dataAccess.user.findById(userId);
    if (!user?.email || !user.emailVerified) return { sent: false, reason: 'VERIFIED_EMAIL_REQUIRED' };
    const amount = formatDepositReceiptAmount(transaction.amount);
    if (!amount) return { sent: false, reason: 'INVALID_DEPOSIT_RECEIPT_AMOUNT' };
    const result = await resend.emails.send({
      from: emailFrom,
      to: user.email,
      subject: 'تم تأكيد إيداع USDT في حسابك - OPERIX',
      html: depositConfirmedTemplate({
        amount,
        transactionId: transaction.id,
        txHash: transaction.txHash,
        creditedAt: transaction.createdAt ? new Date(transaction.createdAt).toLocaleString('ar') : new Date().toLocaleString('ar')
      })
    });
    if (result?.error) throw new Error(result.error.message || 'EMAIL_PROVIDER_REJECTED');
    return { sent: true };
  } catch (error) {
    console.error('TRON deposit confirmation email failed:', error.message);
    return { sent: false, reason: 'EMAIL_DELIVERY_FAILED' };
  }
}

async function processAddress(addressRow, resend) {
  const config = blockchainService.getBlockchainConfig().TRC20;
  const tronWeb = getTronWeb();
  const expectedTo = normalizeTronAddress(addressRow.address, tronWeb);
  const expectedContract = normalizeTronAddress(config.tokenContract, tronWeb);
  if (!expectedTo || !expectedContract) throw new Error('INVALID_TRON_DEPOSIT_CONFIGURATION');

  const priorCursor = addressRow.lastScannedAt ? new Date(addressRow.lastScannedAt).getTime() : new Date(addressRow.createdAt).getTime();
  let minTimestamp = Math.max(0, priorCursor - LOOKBACK_MS);
  let newestTimestamp = Number.isFinite(priorCursor) ? priorCursor : Date.now() - LOOKBACK_MS;
  let fingerprint = '';
  let pages = 0;
  let credited = 0;
  let duplicates = 0;
  let emailNotificationsSent = 0;
  let emailNotificationsFailed = 0;

  do {
    const params = new URLSearchParams({
      only_confirmed: 'true',
      contract_address: config.tokenContract,
      min_timestamp: String(minTimestamp),
      order_by: 'block_timestamp,asc',
      limit: String(PAGE_SIZE)
    });
    if (fingerprint) params.set('fingerprint', fingerprint);
    const result = await fetchTronGrid(`v1/accounts/${encodeURIComponent(addressRow.address)}/transactions/trc20?${params}`);
    const transfers = Array.isArray(result.data) ? result.data : [];
    pages++;

    for (const transfer of transfers) {
      const txHash = String(transfer.transaction_id || '').trim().toLowerCase();
      const toAddress = String(transfer.to || '').trim();
      const tokenAddress = String(transfer.token_info?.address || transfer.contract_address || '').trim();
      const rawValue = String(transfer.value || '').trim();
      const timestamp = Number(transfer.block_timestamp || 0);
      if (Number.isFinite(timestamp)) newestTimestamp = Math.max(newestTimestamp, timestamp);
      if (!/^[a-f0-9]{64}$/.test(txHash) || !/^\d+$/.test(rawValue) || BigInt(rawValue) <= 0n) continue;
      if (normalizeTronAddress(toAddress, tronWeb) !== expectedTo || normalizeTronAddress(tokenAddress, tronWeb) !== expectedContract) continue;

      const result = await dataAccess.callSupabaseRpc('operix_tron_deposit_credit_atomic', {
        p_user_id: addressRow.userId,
        p_tx_hash: txHash,
        p_event_index: Number.isSafeInteger(Number(transfer.event_index)) ? Number(transfer.event_index) : 0,
        p_from_address: String(transfer.from || ''),
        p_to_address: addressRow.address,
        p_amount: formatUsdt(rawValue),
        p_block_timestamp: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : new Date().toISOString()
      });
      if (result?.credited) {
        credited++;
        const emailResult = await sendDepositConfirmationEmail(resend, addressRow.userId, result.transaction);
        if (emailResult.sent) emailNotificationsSent++;
        else if (emailResult.reason !== 'EMAIL_PROVIDER_NOT_CONFIGURED' && emailResult.reason !== 'VERIFIED_EMAIL_REQUIRED') emailNotificationsFailed++;
        try {
          await realtimeService.publish('user_data_changed', { reason: 'deposit_created', timestamp: new Date().toISOString() }, { userId: addressRow.userId });
          await realtimeService.publish('admin_transaction_created', { transactionId: result.transaction?.id, type: 'deposit', userId: addressRow.userId }, { scope: 'admin' });
        } catch (error) {
          console.error('TRON deposit realtime notification failed:', error.message);
        }
      } else if (result?.duplicate) {
        duplicates++;
      }
    }

    fingerprint = String(result.meta?.fingerprint || '');
    if (transfers.length < PAGE_SIZE) fingerprint = '';
  } while (fingerprint && pages < MAX_PAGES_PER_ADDRESS);

  const nextCursor = new Date(Math.max(newestTimestamp, Date.now() - LOOKBACK_MS));
  await dataAccess.tronDepositAddress.updateOne({ userId: addressRow.userId }, { lastScannedAt: nextCursor });
  return { userId: addressRow.userId, pages, credited, duplicates, emailNotificationsSent, emailNotificationsFailed, cursor: nextCursor.toISOString() };
}

async function processTronDepositQueue(resend) {
  if (String(process.env.TRON_DEPOSIT_AUTOMATION_ENABLED || '').toLowerCase() !== 'true') {
    return { processed: 0, skipped: true, reason: 'TRON_DEPOSIT_AUTOMATION_DISABLED' };
  }
  if (!dataAccess.isSupabaseRuntime()) return { processed: 0, skipped: true, reason: 'SUPABASE_RUNTIME_REQUIRED' };
  if (!process.env.TRON_DEPOSIT_XPUB) return { processed: 0, skipped: true, reason: 'TRON_DEPOSIT_XPUB_NOT_CONFIGURED' };

  const limit = Math.min(50, Math.max(1, Number(process.env.TRON_DEPOSIT_SCAN_BATCH || 10)));
  const addresses = await dataAccess.tronDepositAddress.find({}, { sort: { lastScannedAt: 1, createdAt: 1 }, limit });
  const results = [];
  for (const address of addresses) {
    try {
      results.push(await processAddress(address, resend));
    } catch (error) {
      console.error(`TRON deposit scan failed for ${address.address}:`, error.message);
      results.push({ userId: address.userId, error: error.message });
    }
  }
  return { processed: results.length, results };
}

module.exports = { deriveDepositAddress, ensureUserDepositAddress, processTronDepositQueue, formatDepositReceiptAmount, sendDepositConfirmationEmail };
