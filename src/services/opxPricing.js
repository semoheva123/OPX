const OPX_INTERNAL_USD_PRICE = 0.10;
const OPX_FUTURE_LISTING_USD_PRICE = 3.00;
const OPX_MAX_UPGRADE_DISCOUNT_SHARE = 0.10;
const OPX_MIN_USDT_UPGRADE_SHARE = 1 - OPX_MAX_UPGRADE_DISCOUNT_SHARE;
const OPX_MAX_UPGRADE_VALUE_USD = 60;

const TIER_DAILY_OPX_CONVERSION = {
  A1: 0.05,
  A2: 0.10,
  A3: 0.15,
  A4: 0,
  A5: 0
};

function getTierDailyOpxConversion(tierCode) {
  const normalized = String(tierCode || '').trim().toUpperCase();
  return Number(TIER_DAILY_OPX_CONVERSION[normalized] || 0);
}

function calculateDailyTaskRewardSplit(dailyProfit, tierCode, taskCount) {
  const totalDailyProfit = Number(dailyProfit || 0);
  const taskLimit = Math.max(1, Number(taskCount || 1));
  const opxDeduction = Math.min(totalDailyProfit, getTierDailyOpxConversion(tierCode));
  const perTaskGross = Number((totalDailyProfit / taskLimit).toFixed(4));
  const perTaskOpx = Number((opxDeduction / taskLimit).toFixed(4));
  const perTaskUsdt = Number((perTaskGross - perTaskOpx).toFixed(4));
  const totalUsdt = Number((totalDailyProfit - opxDeduction).toFixed(4));

  return {
    totalDailyProfit,
    opxDailyDeduction: Number(opxDeduction.toFixed(4)),
    totalUsdt,
    totalOpx: Number(opxDeduction.toFixed(4)),
    perTaskGross,
    perTaskOpx,
    perTaskUsdt
  };
}

function calculateOpxForUsd(usdAmount) {
  return Number((Math.max(0, Number(usdAmount) || 0) / OPX_INTERNAL_USD_PRICE).toFixed(4));
}

function applyOpxUpgradePayment(user, usdAmount, options = {}) {
  const upgradeCost = Number((Math.max(0, Number(usdAmount) || 0)).toFixed(2));
  if (options.allowOpx === false) {
    if (Number(user.wallet.depositBalance || 0) < upgradeCost) {
      throw new Error(`INSUFFICIENT:${upgradeCost}:0:${upgradeCost}:${user.wallet.depositBalance}`);
    }
    user.wallet.depositBalance = Number((user.wallet.depositBalance - upgradeCost).toFixed(2));
    syncWallet(user);
    return { upgradeCost, opxAmount: 0, opxValue: 0, usdtAmount: upgradeCost };
  }
  const availableOpx = Number(user.OPX_balance || 0);
  const maxOpxValue = Number(Math.min(upgradeCost * OPX_MAX_UPGRADE_DISCOUNT_SHARE, OPX_MAX_UPGRADE_VALUE_USD).toFixed(2));
  const opxAmount = Number(Math.min(availableOpx, calculateOpxForUsd(maxOpxValue)).toFixed(4));
  const opxValue = Number((opxAmount * OPX_INTERNAL_USD_PRICE).toFixed(2));
  const usdtAmount = Number(Math.max(0, upgradeCost - opxValue).toFixed(2));

  if (Number(user.wallet.depositBalance || 0) < usdtAmount) {
    throw new Error(`INSUFFICIENT:${upgradeCost}:${opxAmount}:${usdtAmount}:${user.wallet.depositBalance}`);
  }

  user.OPX_balance = Number((availableOpx - opxAmount).toFixed(4));
  let remainingUsdt = usdtAmount;
  if (user.wallet.depositBalance >= remainingUsdt) user.wallet.depositBalance -= remainingUsdt;
  else {
    remainingUsdt -= user.wallet.depositBalance;
    user.wallet.depositBalance = 0;
    user.wallet.profitBalance -= remainingUsdt;
  }
  syncWallet(user);

  return { upgradeCost, opxAmount, opxValue, usdtAmount };
}

function syncWallet(user) {
  if (typeof user.syncWallet === 'function') return user.syncWallet();
  user.wallet = user.wallet || {};
  user.wallet.depositBalance = Number(Number(user.wallet.depositBalance || 0).toFixed(2));
  user.wallet.profitBalance = Number(Number(user.wallet.profitBalance || 0).toFixed(2));
  user.wallet.balance = Number((user.wallet.depositBalance + user.wallet.profitBalance).toFixed(2));
  user.USDT_balance = user.wallet.balance;
  return user;
}

module.exports = {
  OPX_INTERNAL_USD_PRICE,
  OPX_FUTURE_LISTING_USD_PRICE,
  OPX_MAX_UPGRADE_DISCOUNT_SHARE,
  OPX_MIN_USDT_UPGRADE_SHARE,
  OPX_MAX_UPGRADE_VALUE_USD,
  TIER_DAILY_OPX_CONVERSION,
  getTierDailyOpxConversion,
  calculateDailyTaskRewardSplit,
  calculateOpxForUsd,
  applyOpxUpgradePayment
};