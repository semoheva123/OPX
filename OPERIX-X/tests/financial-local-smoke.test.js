const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../src/models/User');
const Transaction = require('../src/models/Transaction');
const walletController = require('../src/controllers/walletController');
const blockchainService = require('../src/services/blockchainService');

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function main() {
  const localMongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
  const allowLocalDbReset = process.env.ALLOW_LOCAL_DB_RESET === 'true';
  let mongoServer = null;

  if (localMongoUri && !allowLocalDbReset) {
    console.error('🛑 Refusing to run the finance smoke test against a configured MongoDB.');
    console.error('Use a temporary in-memory MongoDB instance or set ALLOW_LOCAL_DB_RESET=true only for explicitly isolated local testing.');
    process.exitCode = 1;
    return;
  }

  if (localMongoUri) {
    await mongoose.connect(localMongoUri);
    console.log('🧪 Using isolated local MongoDB:', localMongoUri);
    await mongoose.connection.db.dropDatabase().catch(() => {});
  } else {
    try {
      mongoServer = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
    } catch (error) {
      console.error('❌ No real local MongoDB is available on this machine.');
      console.error('Set MONGO_URI to a local isolated database, e.g. mongodb://127.0.0.1:27017/operix_finance_test');
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
    console.log('🧪 Using isolated MongoDB memory server:', mongoUri);
  }

  const originalVerify = blockchainService.verifyDeposit;
  blockchainService.verifyDeposit = async (amount, network, txHash) => ({
    amount: Number(amount),
    network,
    txHash,
    config: { depositAddress: 'TEST_DEPOSIT_ADDRESS' }
  });

  try {
    const user = await User.create({
      email: `finance-${Date.now()}@example.com`,
      password: 'TestPass123!',
      emailVerified: true,
      kycStatus: 'verified',
      twoFactorEnabled: true,
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      walletAddress: 'TQyB5oVh8uY6jRrL2Q4nH7mL2tV9KPQxWF',
      wallet: {
        balance: 0,
        depositBalance: 0,
        profitBalance: 0,
        totalDeposits: 0,
        totalWithdrawn: 0
      },
      USDT_balance: 0,
      OPX_balance: 0,
      role: 'user'
    });

    const txHash = '0x' + crypto.randomBytes(32).toString('hex');

    const depositReq = {
      user: { id: user._id.toString() },
      body: { amount: '100', network: 'BEP20', txHash }
    };
    const depositRes = makeResponse();
    await walletController.deposit(depositReq, depositRes);
    assert.equal(depositRes.statusCode, 201, 'Deposit should succeed');
    assert.equal(depositRes.body.success, true, 'Deposit success flag should be true');
    assert.equal(Number(depositRes.body.wallet.depositBalance), 100, 'Deposit balance should increase');
    assert.equal(Number(depositRes.body.wallet.balance), 100, 'Wallet balance should match deposit balance after funding');
    assert.equal(Number(depositRes.body.wallet.balance), Number(depositRes.body.wallet.depositBalance), 'Balance must equal depositBalance when no profit exists');

    const duplicateRes = makeResponse();
    await walletController.deposit(depositReq, duplicateRes);
    assert.equal(duplicateRes.statusCode, 409, 'Duplicate txHash should be rejected');

    const depositTx = await Transaction.findOne({ userId: user._id, type: 'deposit', txHash });
    assert.ok(depositTx, 'Deposit transaction should exist');

    const freshUser = await User.findById(user._id).select('+twoFactorSecret');
    freshUser.wallet.profitBalance = 50;
    freshUser.wallet.balance = freshUser.wallet.depositBalance + freshUser.wallet.profitBalance;
    await freshUser.save();

    const invalidWithdrawRes = makeResponse();
    await walletController.withdraw({
      user: { id: user._id.toString() },
      ip: '127.0.0.1',
      get: (name) => name === 'user-agent' ? 'test-agent' : '',
      app: { locals: { resend: null } },
      body: {
        amount: '20',
        walletAddress: freshUser.walletAddress,
        twoFactorCode: '000000',
        image_url: 'https://i.ibb.co/example.png'
      }
    }, invalidWithdrawRes);
    assert.equal(invalidWithdrawRes.statusCode, 400, 'Invalid 2FA should be rejected');

    const otp = require('otplib').authenticator.generate(freshUser.twoFactorSecret);
    const validWithdrawRes = makeResponse();
    await walletController.withdraw({
      user: { id: user._id.toString() },
      ip: '127.0.0.1',
      get: (name) => name === 'user-agent' ? 'test-agent' : '',
      app: { locals: { resend: null } },
      body: {
        amount: '20',
        walletAddress: freshUser.walletAddress,
        twoFactorCode: otp,
        image_url: 'https://i.ibb.co/example.png'
      }
    }, validWithdrawRes);
    assert.equal(validWithdrawRes.statusCode, 200, 'Valid withdraw should succeed');

    const withdrawTx = await Transaction.findOne({ userId: user._id, type: 'withdraw', amount: 20 }).sort({ createdAt: -1 });
    assert.ok(withdrawTx, 'Withdraw transaction should exist');

    const afterUser = await User.findById(user._id);
    assert.ok(Number(afterUser.wallet.profitBalance) >= 0, 'Profit balance should not go negative');
    assert.equal(Number(afterUser.wallet.balance), Number(afterUser.wallet.depositBalance) + Number(afterUser.wallet.profitBalance), 'Wallet balance must equal deposit + profit always');
    assert.equal(Number(afterUser.USDT_balance), Number(afterUser.wallet.balance), 'USDT balance must match wallet balance to avoid drift');

    console.log('✅ Isolated finance smoke test passed');
    console.log({
      userId: user._id.toString(),
      depositBalance: afterUser.wallet.depositBalance,
      profitBalance: afterUser.wallet.profitBalance,
      totalBalance: afterUser.wallet.balance
    });
  } finally {
    blockchainService.verifyDeposit = originalVerify;
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mongoServer) await mongoServer.stop();
  }
}

main().catch((error) => {
  console.error('❌ Finance smoke test failed');
  console.error(error);
  process.exitCode = 1;
});
