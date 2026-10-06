const assert = require('node:assert/strict');
const dataAccess = require('../src/services/dataAccess');
const userController = require('../src/controllers/userController');

const originals = {
  isSupabaseRuntime: dataAccess.isSupabaseRuntime,
  findUser: dataAccess.user.findById,
  countUsers: dataAccess.user.countDocuments,
  findTransactions: dataAccess.transaction.find,
  findLevels: dataAccess.vipLevel.find,
  findCompletions: dataAccess.dailyTaskCompletion.find
};

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

(async () => {
  try {
    dataAccess.isSupabaseRuntime = () => true;
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const user = {
      id: 'user-1',
      email: 'official@operix.website',
      referralCode: 'TEAM1',
      tierCode: 'A3',
      createdAt: yesterday.toISOString(),
      walletAddress: '',
      wallet: { totalDeposits: 0 }
    };
    const transactions = [
      { type: 'reward', status: 'approved', amount: 1.25, usdtAmount: 1.25, createdAt: new Date(today.getTime() + 3600000).toISOString() },
      { type: 'reward', status: 'approved', amount: 2, usdtAmount: 2, createdAt: yesterday.toISOString() },
      { type: 'deposit', status: 'pending', amount: 10, createdAt: now.toISOString() }
    ];

    dataAccess.user.findById = async () => user;
    dataAccess.user.countDocuments = async () => 7;
    dataAccess.transaction.find = async () => transactions;
    dataAccess.vipLevel.find = async () => [
      { code: 'A1', name: 'A1', price: 50, dailyProfit: 1.5, tasks: 8 },
      { code: 'A2', name: 'A2', price: 150, dailyProfit: 3, tasks: 12 },
      { code: 'A3', name: 'A3', price: 350, dailyProfit: 8, tasks: 18 },
      { code: 'A4', name: 'A4', price: 750, dailyProfit: 16, tasks: 22 }
    ];
    dataAccess.dailyTaskCompletion.find = async () => [{ taskKey: 'A3-community' }, { taskKey: 'A3-task-02' }];

    const response = responseRecorder();
    await userController.getHomeSummary({ user: { id: user.id } }, response);
    assert.equal(response.statusCode, 200, 'the Supabase home summary must respond successfully');
    assert.equal(response.body.summary.completedTasks, 2, 'daily progress must use UTC completion rows, not a stale user counter');
    assert.equal(response.body.summary.todayEarned, 1.25);
    assert.equal(response.body.summary.earnings.week, 3.25);
    assert.equal(response.body.summary.referralCount, 7);
    assert.equal(response.body.summary.pendingTransactions, 1);
    assert.equal(response.body.summary.nextLevel.code, 'A4');
    assert.equal(response.body.summary.healthChecks.deposit, true, 'paid-feature access should satisfy the home readiness activation check');
    console.log('Supabase home summary tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.isSupabaseRuntime = originals.isSupabaseRuntime;
    dataAccess.user.findById = originals.findUser;
    dataAccess.user.countDocuments = originals.countUsers;
    dataAccess.transaction.find = originals.findTransactions;
    dataAccess.vipLevel.find = originals.findLevels;
    dataAccess.dailyTaskCompletion.find = originals.findCompletions;
  }
})();
