const crypto = require('crypto');

const API_BASE_URL = 'https://api.nowpayments.io/v1';
const PAYMENT_CURRENCY = 'usdttrc20';

function getNowPaymentsConfig() {
  return {
    apiKey: String(process.env.NOWPAYMENTS_API_KEY || '').trim(),
    ipnSecret: String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim(),
    callbackUrl: `${String(process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '')}/api/wallet/deposit/nowpayments/ipn`
  };
}

function isNowPaymentsReady(config = getNowPaymentsConfig()) {
  if (!config.apiKey || !config.ipnSecret || String(process.env.JWT_SECRET || '').trim().length < 32) return false;
  try {
    const callback = new URL(config.callbackUrl);
    return callback.protocol === 'https:' && Boolean(callback.hostname);
  } catch {
    return false;
  }
}

function formatUsdtAmount(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(text)) throw new Error('INVALID_DEPOSIT_AMOUNT');
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) throw new Error('INVALID_DEPOSIT_AMOUNT');
  return amount.toFixed(4);
}

function createSignedOrderId(userId, amount) {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (secret.length < 32) throw new Error('DEPOSIT_ORDER_SECRET_NOT_CONFIGURED');
  const normalizedUserId = String(userId || '').trim().toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(normalizedUserId)) {
    throw new Error('INVALID_DEPOSIT_USER_ID');
  }
  const [whole, fraction = ''] = formatUsdtAmount(amount).split('.');
  const amountUnits = (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))).toString(36);
  const userBytes = Buffer.from(normalizedUserId.replace(/-/g, ''), 'hex');
  const payload = `${userBytes.toString('base64url')}.${amountUnits}.${crypto.randomBytes(6).toString('base64url')}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest().subarray(0, 16).toString('base64url');
  return `${payload}.${signature}`;
}

function verifySignedOrderId(orderId) {
  const [encodedUserId, amountUnitsText, nonce, suppliedSignature, ...extra] = String(orderId || '').split('.');
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (String(orderId || '').length > 64 || !encodedUserId || !/^[0-9a-z]{1,10}$/.test(amountUnitsText || '') ||
      !/^[A-Za-z0-9_-]{8}$/.test(nonce || '') || !/^[A-Za-z0-9_-]{22}$/.test(suppliedSignature || '') || extra.length || secret.length < 32) return null;
  const payload = `${encodedUserId}.${amountUnitsText}.${nonce}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest().subarray(0, 16);
  let supplied;
  try { supplied = Buffer.from(suppliedSignature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const userHex = Buffer.from(encodedUserId, 'base64url').toString('hex');
    if (userHex.length !== 32) return null;
    const userId = `${userHex.slice(0, 8)}-${userHex.slice(8, 12)}-${userHex.slice(12, 16)}-${userHex.slice(16, 20)}-${userHex.slice(20)}`;
    const units = [...amountUnitsText].reduce((total, digit) => total * 36n + BigInt(parseInt(digit, 36)), 0n);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(userId) || units < 10000n || units > 10000000000n) return null;
    const whole = units / 10000n;
    const fraction = String(units % 10000n).padStart(4, '0');
    const amount = `${whole}.${fraction}`;
    if (formatUsdtAmount(amount) !== amount) return null;
    return { userId, amount, nonce };
  } catch {
    return null;
  }
}

function sortObjectKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeysDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((sorted, key) => {
    sorted[key] = sortObjectKeysDeep(value[key]);
    return sorted;
  }, {});
}

function verifyIpnSignature(payload, signature, ipnSecret = getNowPaymentsConfig().ipnSecret) {
  const secret = String(ipnSecret || '').trim();
  const supplied = String(signature || '').trim().toLowerCase();
  if (!secret || !/^[a-f0-9]{128}$/.test(supplied)) return false;
  const canonical = JSON.stringify(sortObjectKeysDeep(payload));
  const expected = crypto.createHmac('sha512', secret).update(canonical).digest();
  const received = Buffer.from(supplied, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function getIpnSignature(req) {
  return String(req.get?.('x-nowpayments-sig') || req.headers?.['x-nowpayments-sig'] || '').trim();
}

async function createPayment({ userId, amount }) {
  const config = getNowPaymentsConfig();
  if (!config.apiKey) throw new Error('NOWPAYMENTS_API_KEY_NOT_CONFIGURED');
  if (!config.ipnSecret) throw new Error('NOWPAYMENTS_IPN_SECRET_NOT_CONFIGURED');
  if (!isNowPaymentsReady(config)) throw new Error('NOWPAYMENTS_CONFIGURATION_INCOMPLETE');
  const priceAmount = formatUsdtAmount(amount);
  const orderId = createSignedOrderId(userId, priceAmount);
  const response = await fetch(`${API_BASE_URL}/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey
    },
    body: JSON.stringify({
      price_amount: Number(priceAmount),
      price_currency: 'usd',
      pay_currency: PAYMENT_CURRENCY,
      ipn_callback_url: config.callbackUrl,
      order_id: orderId,
      order_description: `OPERIX USDT TRC20 deposit for ${userId}`
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(data.message || data.msg || data.error || '').slice(0, 240);
    throw new Error(detail ? `NOWPAYMENTS_CREATE_PAYMENT_FAILED:${detail}` : 'NOWPAYMENTS_CREATE_PAYMENT_FAILED');
  }
  if (!data.payment_id || !data.pay_address || !data.pay_amount || String(data.pay_currency || '').toLowerCase() !== PAYMENT_CURRENCY) {
    throw new Error('NOWPAYMENTS_INVALID_PAYMENT_RESPONSE');
  }
  return {
    paymentId: String(data.payment_id),
    orderId,
    userId: String(userId),
    priceAmount,
    priceCurrency: String(data.price_currency || 'usd').toLowerCase(),
    payAmount: String(data.pay_amount),
    payCurrency: PAYMENT_CURRENCY,
    payAddress: String(data.pay_address),
    paymentStatus: String(data.payment_status || 'waiting')
  };
}

async function getPaymentStatus(paymentId) {
  const { apiKey } = getNowPaymentsConfig();
  if (!apiKey) throw new Error('NOWPAYMENTS_API_KEY_NOT_CONFIGURED');
  if (!/^\d+$/.test(String(paymentId || ''))) throw new Error('INVALID_NOWPAYMENTS_PAYMENT_ID');
  const response = await fetch(`${API_BASE_URL}/payment/${encodeURIComponent(paymentId)}`, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('NOWPAYMENTS_STATUS_LOOKUP_FAILED');
  return data;
}

function getPaymentTxHash(payment) {
  const candidates = [payment?.tx_hash, payment?.transaction_hash, payment?.hash];
  return String(candidates.find(value => /^[a-f0-9]{64}$/i.test(String(value || '').trim())) || '').trim().toLowerCase();
}

function buildPaymentReference(paymentId) {
  return `NOWPAYMENTS:${crypto.createHash('sha256').update(String(paymentId)).digest('hex')}`;
}

module.exports = {
  API_BASE_URL,
  PAYMENT_CURRENCY,
  getNowPaymentsConfig,
  isNowPaymentsReady,
  formatUsdtAmount,
  createSignedOrderId,
  verifySignedOrderId,
  verifyIpnSignature,
  getIpnSignature,
  createPayment,
  getPaymentStatus,
  getPaymentTxHash,
  buildPaymentReference
};
