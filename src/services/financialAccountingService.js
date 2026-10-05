const dataAccess = require('./dataAccess');

const ACCOUNTING_TRANSACTION_TYPES = new Set([
  'deposit', 'withdraw', 'reward', 'staking_reward', 'referral_commission',
  'upgrade_deduction', 'token_burn', 'vault_lock', 'vault_release',
  'vault_early_release', 'vault_penalty', 'admin_adjustment'
]);
const REWARD_TYPES = new Set(['reward', 'staking_reward', 'referral_commission']);
const PAGE_SIZE = 10000;

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateFinancialAccounting({ transactions = [], users = [], vaults = [], stakings = [], ledger = [], periodDays = 30 }) {
  const approved = transactions.filter(transaction => transaction.status === 'approved');
  const deposits = approved.filter(transaction => transaction.type === 'deposit');
  const withdrawals = approved.filter(transaction => transaction.type === 'withdraw');
  const tierActivations = approved.filter(transaction => transaction.type === 'upgrade_deduction');
  const rewards = approved.filter(transaction => REWARD_TYPES.has(transaction.type));
  const ledgerReferences = new Set(ledger.map(entry => String(entry.referenceId || '')).filter(Boolean));
  const trackedTransactions = transactions.filter(transaction => ACCOUNTING_TRANSACTION_TYPES.has(transaction.type));
  const unmatchedLedgerTransactions = trackedTransactions.filter(transaction => !ledgerReferences.has(String(transaction.id || transaction._id || '')));

  const unclassifiedRewards = rewards.filter(transaction =>
    amount(transaction.amount) > 0 && amount(transaction.usdtAmount) === 0 && amount(transaction.opxAmount) === 0
  );
  const walletLiabilities = users.reduce((sum, user) => {
    const wallet = user.wallet || {};
    return sum + amount(wallet.depositBalance) + amount(wallet.profitBalance);
  }, 0);
  const activeVaults = vaults.filter(vault => vault.status === 'active');
  const vaultPrincipalLiability = activeVaults.reduce((sum, vault) => sum + amount(vault.amount), 0);
  const vaultIncentiveLiability = activeVaults.reduce((sum, vault) => sum + amount(vault.incentiveAmount ?? vault.expectedProfit), 0);
  const activeStakings = stakings.filter(staking => staking.status === 'active');
  const stakingPrincipalLiability = activeStakings.reduce((sum, staking) => sum + amount(staking.amount), 0);
  const stakingIncentiveLiability = activeStakings.reduce((sum, staking) => sum + amount(staking.expectedProfit), 0);

  const depositInflow = deposits.reduce((sum, transaction) => sum + amount(transaction.amount), 0);
  const confirmedWithdrawalGross = withdrawals.reduce((sum, transaction) => sum + amount(transaction.amount), 0);
  const confirmedWithdrawalCash = withdrawals.reduce((sum, transaction) => sum + amount(transaction.netAmount || transaction.amount), 0);
  const withdrawalFeeIncome = withdrawals.reduce((sum, transaction) => sum + amount(transaction.feeAmount), 0);
  const tierRevenueUsdt = tierActivations.reduce((sum, transaction) => sum + amount(transaction.usdtAmount), 0);
  const tierOpxUnits = tierActivations.reduce((sum, transaction) => sum + amount(transaction.opxAmount), 0);
  const rewardCreditsUsdt = rewards.reduce((sum, transaction) => sum + amount(transaction.usdtAmount), 0);
  const rewardCreditsOpx = rewards.reduce((sum, transaction) => sum + amount(transaction.opxAmount), 0);
  const vaultIncentivesRealized = ledger
    .filter(entry => entry.type === 'vault_release' && entry.status === 'approved')
    .reduce((sum, entry) => sum + amount(entry.metadata?.incentiveAmount), 0);
  const estimatedContribution = tierRevenueUsdt + withdrawalFeeIncome - rewardCreditsUsdt - vaultIncentivesRealized;

  const days = new Map();
  transactions.forEach(transaction => {
    const day = String(transaction.createdAt || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const row = days.get(day) || { date: day, deposits: 0, paidWithdrawals: 0, tierRevenueUsdt: 0, rewardCreditsUsdt: 0, count: 0 };
    if (transaction.type === 'deposit' && transaction.status === 'approved') row.deposits += amount(transaction.amount);
    if (transaction.type === 'withdraw' && transaction.status === 'approved') row.paidWithdrawals += amount(transaction.netAmount || transaction.amount);
    if (transaction.type === 'upgrade_deduction' && transaction.status === 'approved') row.tierRevenueUsdt += amount(transaction.usdtAmount);
    if (REWARD_TYPES.has(transaction.type) && transaction.status === 'approved') row.rewardCreditsUsdt += amount(transaction.usdtAmount);
    row.count++;
    days.set(day, row);
  });

  return {
    periodDays,
    period: {
      verifiedDepositInflow: depositInflow,
      confirmedWithdrawalGross,
      confirmedWithdrawalCash,
      withdrawalFeeIncome,
      tierRevenueUsdt,
      tierOpxUnits,
      rewardCreditsUsdt,
      rewardCreditsOpx,
      vaultIncentivesRealized,
      externalNetCashFlow: depositInflow - confirmedWithdrawalCash,
      estimatedContributionBeforeOperatingCosts: estimatedContribution,
      depositCount: deposits.length,
      paidWithdrawalCount: withdrawals.length,
      tierActivationCount: tierActivations.length,
      rewardTransactionCount: rewards.length
    },
    obligations: {
      walletBalances: walletLiabilities,
      lockedVaultPrincipal: vaultPrincipalLiability,
      expectedVaultIncentives: vaultIncentiveLiability,
      activeStakingPrincipal: stakingPrincipalLiability,
      expectedStakingIncentives: stakingIncentiveLiability,
      totalTrackedCustomerObligations: walletLiabilities + vaultPrincipalLiability + vaultIncentiveLiability + stakingPrincipalLiability + stakingIncentiveLiability,
      activeVaultCount: activeVaults.length,
      activeStakingCount: activeStakings.length
    },
    reconciliation: {
      transactionsInPeriod: transactions.length,
      ledgerEntriesInPeriod: ledger.length,
      unmatchedFinancialTransactions: unmatchedLedgerTransactions.length,
      unmatchedTransactionTypes: [...new Set(unmatchedLedgerTransactions.map(transaction => transaction.type))],
      unclassifiedRewardTransactions: unclassifiedRewards.length,
      unclassifiedRewardAmount: unclassifiedRewards.reduce((sum, transaction) => sum + amount(transaction.amount), 0),
      sampleUnmatchedTransactionIds: unmatchedLedgerTransactions.slice(0, 10).map(transaction => String(transaction.id || transaction._id || ''))
    },
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  };
}

async function buildFinancialAccountingSummary(periodDays = 30, now = new Date()) {
  const days = Math.max(1, Math.min(365, Number(periodDays) || 30));
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const range = { $gte: since };
  const [transactions, ledger, users, vaults, stakings] = await Promise.all([
    dataAccess.transaction.find({ createdAt: range }, { sort: { createdAt: -1 }, limit: PAGE_SIZE }),
    dataAccess.financialLedger.find({ createdAt: range }, { sort: { createdAt: -1 }, limit: PAGE_SIZE }),
    dataAccess.user.find({}, { limit: PAGE_SIZE }),
    dataAccess.investmentVault.find({}, { limit: PAGE_SIZE }),
    dataAccess.staking.find({}, { limit: PAGE_SIZE })
  ]);
  return calculateFinancialAccounting({ transactions, ledger, users, vaults, stakings, periodDays: days });
}

module.exports = { calculateFinancialAccounting, buildFinancialAccountingSummary };
