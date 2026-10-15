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
  assert.equal(nowPayments.calculateDepositSurcharge('50'), '1.0000');
  assert.equal(nowPayments.calculateDepositCharge('50'), '51.0000', 'a 50 USDT deposit must require exactly 51 USDT');
  assert.equal(nowPayments.calculateDepositSurcharge('100'), '1.0000');
  assert.equal(nowPayments.calculateDepositCharge('100'), '101.0000');
  assert.equal(nowPayments.calculateDepositSurcharge('10.5555'), '1.0000', 'the new fee must stay fixed regardless of the requested principal');
  assert.equal(nowPayments.calculateDepositCharge('10.5555'), '11.5555');
  assert.equal(nowPayments.calculateDepositSurcharge('1000000'), '1.0000');
  assert.equal(nowPayments.calculateLegacyPercentageDepositSurcharge('10.5555'), '0.1056', 'existing percentage-priced orders remain verifiable');
  assert.equal(nowPayments.calculateDepositChargeWithSurcharge('25.5', '0.2550'), '25.7550', 'existing percentage-priced invoices retain their original total');
  assert.equal(nowPayments.isSupportedDepositSurcharge('25.5', '0.2550'), true);
  assert.equal(nowPayments.isSupportedDepositSurcharge('25.5', '1.0000'), true);
  assert.equal(nowPayments.isSupportedDepositSurcharge('25.5', '0.5000'), false);
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
  assert.equal(nowPayments.isNowPaymentsReady(), true);
  assert.equal(nowPayments.isNowPaymentsReady({ apiKey: 'test-api-key', ipnSecret: 'test-ipn-secret', callbackUrl: 'http://operix.example/api/ipn' }), false,
    'NOWPayments deposit configuration must require an HTTPS callback URL');
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/walletRoutes.js'), 'utf8');
  const walletControllerSource = fs.readFileSync(path.join(__dirname, '../src/controllers/walletController.js'), 'utf8');
  const tronDepositServiceSource = fs.readFileSync(path.join(__dirname, '../src/services/tronDepositService.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/nowpayments-trc20-deposits.sql'), 'utf8');
  const surchargeMigration = fs.readFileSync(path.join(__dirname, '../supabase/nowpayments-deposit-surcharge.sql'), 'utf8');
  const partialPaymentMigration = fs.readFileSync(path.join(__dirname, '../supabase/nowpayments-partial-payment-credit.sql'), 'utf8');
  const fixedFeeMigration = fs.readFileSync(path.join(__dirname, '../supabase/nowpayments-fixed-deposit-fee.sql'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const premiumStyles = fs.readFileSync(path.join(__dirname, '../styles/operix-premium.css'), 'utf8');
  assert.match(routeSource, /wallet\/deposit\/nowpayments\/ipn/);
  assert.match(routeSource, /wallet\/deposit\/nowpayments\/create',\s*verifyToken/);
  assert.match(walletControllerSource, /بوابة NOWPayments غير جاهزة حاليًا؛ لا ترسل أي تحويل مباشر/);
  assert.match(walletControllerSource, /إيداع TxHash|الإيداع عبر TxHash/);
  assert.doesNotMatch(walletControllerSource, /actualPaid \+ 0\.0000001 < requiredPayAmount/,
    'NOWPayments should credit any positive payment once it is finished, rather than rejecting partial underpayment');
  assert.doesNotMatch(walletControllerSource, /ensureUserDepositAddress\(req\.user\.id\)/);
  assert.match(tronDepositServiceSource, /reason: 'NOWPAYMENTS_ONLY'/);
  assert.match(migration, /operix_nowpayments_deposit_credit_atomic/);
  assert.match(migration, /least\(.*p_actually_paid.*p_price_amount.*\)/,
    'crediting must use the actual received amount, capped by the order value');
  assert.match(partialPaymentMigration, /least\(p_actually_paid, p_price_amount\)/,
    'the production patch must cap credit at both actual payment and requested principal');
  assert.doesNotMatch(partialPaymentMigration, /p_actually_paid\s*\+\s*0\.0000001\s*<\s*order_row\.pay_amount/,
    'finished positive partial payments must not be rejected for being below the original quote');
  assert.match(partialPaymentMigration, /intentionally does not\s+-- modify existing orders, wallet balances, or ledger entries/i,
    'the incremental production migration must preserve existing payment orders and balances');
  assert.match(fixedFeeMigration, /p_surcharge_amount\s*<>\s*1\.0000/i,
    'the live database must enforce a flat 1 USDT fee for new deposit orders');
  assert.match(fixedFeeMigration, /p_charge_amount\s*<>\s*p_price_amount\s*\+\s*1\.0000/i,
    'the database must enforce principal plus exactly 1 USDT');
  assert.match(fixedFeeMigration, /Existing payment orders and balances are intentionally left unchanged/i);
  assert.doesNotMatch(fixedFeeMigration, /update\s+public\.nowpayments_deposit_orders/i,
    'the fixed-fee migration must not rewrite historical or pending orders');
  assert.match(migration, /surcharge_amount numeric\(18,4\)/);
  assert.match(surchargeMigration, /round\(p_price_amount\*0\.01,4\)/);
  assert.match(surchargeMigration, /charges 101 USD, wallet credits 100 USDT/i);
  assert.match(surchargeMigration, /creditAmount',order_row\.price_amount/);
  assert.match(surchargeMigration, /deposit_fee_income/);
  assert.match(surchargeMigration, /if order_row\.transaction_id is not null[\s\S]*?'duplicate',true/);
  assert.match(walletControllerSource, /surchargeAmount,[\s\S]*?chargeAmount,/);
  assert.match(indexSource, /id="depositNetworkInstructions"/);
  assert.match(appSource, /رسمًا ثابتًا قدره \$\{preview\.surchargeAmount\} USDT/);
  assert.doesNotMatch(appSource, /رسم 1%/);
  assert.match(indexSource, /nowPaymentsSurchargeAmount/);
  assert.match(indexSource, /id="nowPaymentsDepositPreview"/);
  assert.match(indexSource, /رسم ثابت قدره 1 USDT/);
  assert.doesNotMatch(indexSource, /رسم منصة 1%/);
  assert.match(appSource, /function calculateNowPaymentsDepositPreview\(amount\)/);
  const depositLoadFlow = appSource.slice(appSource.indexOf('async function loadDepositAddress()'), appSource.indexOf('async function createNowPaymentsDeposit()'));
  assert.doesNotMatch(depositLoadFlow, /await createNowPaymentsDeposit\(\)/, 'opening the deposit modal must not create a payment before the user reviews the fee and total');
  assert.match(premiumStyles, /#depositModal > \.deposit-modal-shell[\s\S]*?overflow-y:\s*auto\s*!important/);

  const originalFetch = global.fetch;
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'http://operix.example';
  await assert.rejects(() => nowPayments.createPayment({ userId, amount: '25.5' }), /NOWPAYMENTS_CONFIGURATION_INCOMPLETE/,
    'payment creation must reject a non-HTTPS callback even when called directly');
  process.env.APP_URL = originalAppUrl;
  let sentRequest;
  global.fetch = async (url, options) => {
    sentRequest = { url, options };
    return {
      ok: true,
      json: async () => ({ payment_id: 123456, pay_address: 'TQ3eH3h2fD1bA7fE8uQnHh1JkL9a9Fj4zr', pay_amount: '26.50000000', price_amount: 26.5, pay_currency: 'usdttrc20', price_currency: 'usd', payment_status: 'waiting' })
    };
  };
  try {
    const payment = await nowPayments.createPayment({ userId, amount: '25.5' });
    assert.equal(payment.paymentId, '123456');
    assert.equal(payment.depositAmount, '25.5000');
    assert.equal(payment.surchargeAmount, '1.0000');
    assert.equal(payment.chargeAmount, '26.5000');
    assert.equal(payment.payAmount, '26.50000000');
    assert.equal(sentRequest.url, 'https://api.nowpayments.io/v1/payment');
    assert.equal(sentRequest.options.headers['x-api-key'], 'test-api-key');
    const body = JSON.parse(sentRequest.options.body);
    assert.equal(body.pay_currency, 'usdttrc20');
    assert.equal(body.price_currency, 'usd');
    assert.equal(body.price_amount, 26.5, 'NOWPayments must charge deposit principal plus the fixed 1 USDT fee');
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
