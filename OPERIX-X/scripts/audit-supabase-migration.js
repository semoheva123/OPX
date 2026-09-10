const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Transaction = require('../src/models/Transaction');
const FinancialLedger = require('../src/models/FinancialLedger');
const { supabaseAdmin } = require('../src/config/supabase');

const tableNames = ['users', 'wallet_balances', 'transactions', 'financial_ledger', 'sessions', 'security_events'];

async function countSupabaseRows(table) {
  const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function main() {
  if (!process.env.MONGO_URI && !process.env.DATABASE_URL) {
    throw new Error('MONGO_URI or DATABASE_URL is required for the migration audit');
  }
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the migration audit');
  }

  await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
  const [mongoUsers, mongoTransactions, mongoLedger, users] = await Promise.all([
    User.countDocuments(),
    Transaction.countDocuments(),
    FinancialLedger.countDocuments(),
    User.find().select('wallet USDT_balance OPX_balance').lean()
  ]);

  const invariantViolations = users.filter(user => {
    const wallet = user.wallet || {};
    const balance = Number(wallet.balance || 0);
    const depositBalance = Number(wallet.depositBalance || 0);
    const profitBalance = Number(wallet.profitBalance || 0);
    const usdtBalance = Number(user.USDT_balance || 0);
    return Math.abs(balance - (depositBalance + profitBalance)) > 0.0001 || Math.abs(usdtBalance - balance) > 0.0001;
  }).length;

  const supabaseCounts = {};
  for (const table of tableNames) {
    supabaseCounts[table] = await countSupabaseRows(table);
  }

  console.log(JSON.stringify({
    mode: process.env.DATABASE_MODE || 'mongo',
    writesPerformed: false,
    mongo: {
      users: mongoUsers,
      transactions: mongoTransactions,
      financialLedger: mongoLedger,
      walletInvariantViolations: invariantViolations
    },
    supabase: supabaseCounts,
    countDifferences: {
      users: mongoUsers - supabaseCounts.users,
      transactions: mongoTransactions - supabaseCounts.transactions,
      financialLedger: mongoLedger - supabaseCounts.financial_ledger
    }
  }, null, 2));

  if (invariantViolations > 0) process.exitCode = 2;
}

main()
  .catch(error => {
    console.error(`Migration audit failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
