const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateFinancialAccounting } = require('../src/services/financialAccountingService');

const tx1 = { id: 'withdraw-1', type: 'withdraw', status: 'approved', amount: 100, feeAmount: 10, netAmount: 90, createdAt: '2026-10-08T10:00:00.000Z' };
const tx2 = { id: 'withdraw-2', type: 'withdraw', status: 'approved', amount: 50, feeAmount: 5, netAmount: 45, createdAt: '2026-10-08T10:30:00.000Z' };
const pendingTx = { id: 'withdraw-3', type: 'withdraw', status: 'pending', amount: 30, feeAmount: 3, netAmount: 27, createdAt: '2026-10-08T11:00:00.000Z' };

const ledgerEntry = {
  id: 'fee-ledger-1',
  type: 'withdrawal_fee_income',
  status: 'approved',
  amount: 10,
  referenceId: 'withdraw-1',
  createdAt: '2026-10-08T10:00:00.000Z'
};

const summary = calculateFinancialAccounting({
  transactions: [tx1, tx2, pendingTx],
  ledger: [ledgerEntry],
  periodDays: 30
});
assert.equal(summary.period.withdrawalFeeIncome, 15, 'ledgered settled fees and legacy approved fees are each counted once');
assert.equal(summary.period.confirmedWithdrawalCash, 135, 'cash outflow uses net payout amounts only');

const fullyLedgeredSummary = calculateFinancialAccounting({
  transactions: [tx1, tx2],
  ledger: [ledgerEntry, { ...ledgerEntry, id: 'fee-ledger-2', referenceId: 'withdraw-2', amount: 5 }],
  periodDays: 30
});
assert.equal(fullyLedgeredSummary.period.withdrawalFeeIncome, 15, 'explicit revenue rows are the accounting source when present');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'withdrawal-fee-revenue.sql'), 'utf8');
assert.match(migration, /financial_ledger_withdrawal_fee_revenue_ref_idx/i, 'fee revenue ledger entries are unique per withdrawal');
assert.match(migration, /tx\.type='withdraw' and tx\.status='approved' and tx\.fee_amount>0/i, 'previously approved withdrawal fees are backfilled');
assert.match(migration, /if tx\.fee_amount > 0 then[\s\S]*?withdrawal_fee_income[\s\S]*?withdrawal_fee_revenue/i, 'fees become revenue only after confirmed payout settlement');
assert.match(migration, /on conflict \(reference_id\) where source='withdrawal_fee_revenue' do nothing/i, 'settlement retries cannot duplicate revenue');

console.log('Withdrawal fee revenue tests passed');