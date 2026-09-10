const USDT_REWARD_SHARE = 0.7;
const OPX_REWARD_SHARE = 0.3;

function splitReward(amount) {
  const grossAmount = Number(amount) || 0;
  const usdtAmount = Number((grossAmount * USDT_REWARD_SHARE).toFixed(4));
  const opxAmount = Number((grossAmount - usdtAmount).toFixed(4));
  return { grossAmount, usdtAmount, opxAmount };
}

function applyRewardToUser(user, amount) {
  const split = splitReward(amount);
  user.wallet = user.wallet || { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 };
  user.wallet.profitBalance = Number((Number(user.wallet.profitBalance || 0) + split.usdtAmount).toFixed(4));
  user.USDT_balance = Number((Number(user.USDT_balance || 0) + split.usdtAmount).toFixed(4));
  user.OPX_balance = Number((Number(user.OPX_balance || 0) + split.opxAmount).toFixed(4));
  if (typeof user.syncWallet === 'function') {
    user.syncWallet();
  } else {
    const depositBalance = Number(Number(user.wallet.depositBalance || 0).toFixed(2));
    const profitBalance = Number(Number(user.wallet.profitBalance || 0).toFixed(2));
    user.wallet.depositBalance = depositBalance;
    user.wallet.profitBalance = profitBalance;
    user.wallet.balance = Number((depositBalance + profitBalance).toFixed(2));
    user.USDT_balance = user.wallet.balance;
  }
  return split;
}

function rewardTransactionFields(split) {
  return {
    amount: split.grossAmount,
    grossAmount: split.grossAmount,
    usdtAmount: split.usdtAmount,
    opxAmount: split.opxAmount
  };
}

module.exports = { USDT_REWARD_SHARE, OPX_REWARD_SHARE, splitReward, applyRewardToUser, rewardTransactionFields };