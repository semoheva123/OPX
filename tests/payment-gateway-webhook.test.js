const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-test-purposes';
process.env.NOWPAYMENTS_API_KEY = 'test-api-key';
process.env.NOWPAYMENTS_IPN_SECRET = 'test-ipn-secret';
process.env.APP_URL = 'https://operix.example';

const nowPayments = require('../src/services/paymentGatewayService');

async function main() {
  assert.equal(nowPayments.formatUsdtAmount('12.34'), '12.3400');
  assert.throws(() => nowPayments.formatUsdtAmount('0.5'), /INVALID_DEPOSIT_AMOUNT/);
  assert.throws(() => nowPayments.formatUsdtAmount('1.12345'), /INVALID_DEPOSIT_AMOUNT/);

  const userId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const signedOrder = nowPayments.createSignedOrderId(userId, '25.5');
  assert.ok(signedOrder.length <= 64, 'NOWPayments order_id stays within 64 characters');
  const order = nowPayments.verifySignedOrderId(signedOrder);
  assert.equal(order.userId, userId);
  assert.equal(order.amount, '25.5000');
  assert.equal(nowPayments.verifySignedOrderId(`${signedOrder}tampered`), null);

  const ipn = {
    payment_id: 123456,
    payment_status: 'finished',
    pay_address: 'TQ3eH3h2fD1bA7fE8uQnHh1JkL9a9Fj4zr',
    price_amount: 25.5,
    price_currency: 'usd',
    pay_amount: 25.61,
    actually_paid: 25.61,
    pay_currency: 'usdttrc20',
    order_id: signedOrder
  };
  const canonical = JSON.stringify(ipn, Object.keys(ipn).sort());
  const signature = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET).update(canonical).digest('hex');
  assert.equal(nowPayments.verifyIpnSignature(ipn, signature), true);
  assert.equal(nowPayments.verifyIpnSignature(ipn, 'invalid'), false);
  assert.equal(nowPayments.PAYMENT_CURRENCY, 'usdttrc20');
  assert.equal(nowPayments.buildPaymentReference('123456').startsWith('NOWPAYMENTS:'), true);
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/walletRoutes.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/nowpayments-trc20-deposits.sql'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const premiumStyles = fs.readFileSync(path.join(__dirname, '../styles/operix-premium.css'), 'utf8');
  assert.match(routeSource, /wallet\/deposit\/nowpayments\/ipn/);
  assert.match(routeSource, /wallet\/deposit\/nowpayments\/create',\s*verifyToken/);
  assert.match(migration, /operix_nowpayments_deposit_credit_atomic/);
  assert.match(migration, /transaction_id uuid unique/);
  assert.match(indexSource, /id="depositNetworkInstructions"/);
  assert.match(appSource, /لا حاجة لإدخال TxHash/);
  assert.match(premiumStyles, /#depositModal > \.deposit-modal-shell[\s\S]*?overflow-y:\s*auto\s*!important/);

  const originalFetch = global.fetch;
  let sentRequest;
  global.fetch = async (url, options) => {
    sentRequest = { url, options };
    return {
      ok: true,
      json: async () => ({ payment_id: 123456, pay_address: 'TQ3eH3h2fD1bA7fE8uQnHh1JkL9a9Fj4zr', pay_amount: '25.61000000', pay_currency: 'usdttrc20', price_currency: 'usd', payment_status: 'waiting' })
    };
  };
  try {
    const payment = await nowPayments.createPayment({ userId, amount: '25.5' });
    assert.equal(payment.paymentId, '123456');
    assert.equal(payment.payAmount, '25.61000000');
    assert.equal(sentRequest.url, 'https://api.nowpayments.io/v1/payment');
    assert.equal(sentRequest.options.headers['x-api-key'], 'test-api-key');
    const body = JSON.parse(sentRequest.options.body);
    assert.equal(body.pay_currency, 'usdttrc20');
    assert.equal(body.price_currency, 'usd');
    assert.equal(body.ipn_callback_url, 'https://operix.example/api/wallet/deposit/nowpayments/ipn');
    assert.ok(body.order_id.length <= 64);
    assert.equal(nowPayments.verifySignedOrderId(body.order_id).userId, userId);
  } finally {
    global.fetch = originalFetch;
  }

  console.log('NOWPayments deposit and IPN tests: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
