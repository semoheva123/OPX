const blockchainService = require('./blockchainService');
const tronProvider = require('./tronProvider');
const dataAccess = require('./dataAccess');
const realtimeService = require('./realtimeService');
const { depositConfirmedTemplate } = require('./emailTemplates');

const TRON_DECIMALS = 6;
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

function getSharedDepositAddress() {
  const address = String(process.env.TRON_SHARED_DEPOSIT_ADDRESS || '').trim();
  if (!address) return '';
  const tronWeb = getLocalTronWeb();
  if (!tronWeb.isAddress(address)) throw new Error('TRON_SHARED_DEPOSIT_ADDRESS_INVALID');
  return tronWeb.address.fromHex(tronWeb.address.toHex(address));
}

async function verifySharedDepositTransfer(txHash, expectedAddress = getSharedDepositAddress()) {
  const normalizedHash = String(txHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw new Error('INVALID_TRON_DEPOSIT_TX_HASH');
  if (!expectedAddress) throw new Error('TRON_SHARED_DEPOSIT_ADDRESS_NOT_CONFIGURED');

  const config = blockchainService.getBlockchainConfig().TRC20;
  const tronWeb = getTronWeb();
  const expectedTo = normalizeTronAddress(expectedAddress, tronWeb);
  const expectedContract = normalizeTronAddress(config.tokenContract, tronWeb);
  if (!expectedTo || !expectedContract) throw new Error('INVALID_TRON_DEPOSIT_CONFIGURATION');

  const result = await tronProvider.requestJsonWithFallback(tronProvider.getIndexerEndpoints(),
    `v1/transactions/${normalizedHash}/events?only_confirmed=true&limit=200`, {
      timeoutMs: 12000,
      validateBody: body => Array.isArray(body?.data)
    });
  let matchingTransfers = result.body.data.filter(event => {
    const name = String(event.event_name || event.eventName || '').toLowerCase();
    const contract = normalizeTronAddress(String(event.contract_address || ''), tronWeb);
    const recipient = normalizeTronAddress(String(event.result?.to ?? event.result?.['1'] ?? ''), tronWeb);
    return name === 'transfer' && contract === expectedContract && recipient === expectedTo;
  });
  if (!matchingTransfers.length) throw new Error('TRON_DEPOSIT_TRANSFER_NOT_FOUND_FOR_SHARED_ADDRESS');

  const rawAmounts = matchingTransfers.map(event => String(event.result?.value ?? event.result?.['2'] ?? '').trim());
  if (rawAmounts.some(value => !/^\d+$/.test(value) || BigInt(value) <= 0n)) throw new Error('INVALID_TRON_DEPOSIT_AMOUNT');
  const rawTotal = rawAmounts.reduce((sum, value) => sum + BigInt(value), 0n);
  // The wallet/transactions tables use 4 decimal places; refuse to silently truncate a valid 6-decimal chain amount.
  if (rawTotal % 100n !== 0n) throw new Error('TRON_DEPOSIT_PRECISION_UNSUPPORTED');
  const fromAddresses = [...new Set(matchingTransfers.map(event => {
    const from = String(event.result?.from ?? event.result?.['0'] ?? '').trim();
    return from ? getLocalTronWeb().address.fromHex(getLocalTronWeb().address.toHex(from)) : '';
  }).filter(Boolean))];
  return {
    txHash: normalizedHash,
    eventIndex: Math.min(...matchingTransfers.map(event => Number.isSafeInteger(Number(event.event_index)) ? Number(event.event_index) : 0)),
    fromAddress: fromAddresses.join(','),
    toAddress: expectedAddress,
    amount: formatUsdt(rawTotal.toString()),
    blockTimestamp: new Date(Math.max(...matchingTransfers.map(event => Number(event.block_timestamp || 0)))).toISOString(),
    transferCount: matchingTransfers.length
  };
}

function formatUsdt(rawAmount) {
  const units = BigInt(String(rawAmount));
  const whole = units / 10n ** BigInt(TRON_DECIMALS);
  const fractional = String(units % 10n ** BigInt(TRON_DECIMALS)).padStart(TRON_DECIMALS, '0').replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : String(whole);
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

module.exports = { formatDepositReceiptAmount, sendDepositConfirmationEmail, getSharedDepositAddress, verifySharedDepositTransfer };
