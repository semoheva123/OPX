const OPX_INTERNAL_USD_PRICE = 0.10;
const OPX_FUTURE_LISTING_USD_PRICE = 3.00;
const OPX_MAX_UPGRADE_DISCOUNT_SHARE = 0.30;
const OPX_MIN_USDT_UPGRADE_SHARE = 1 - OPX_MAX_UPGRADE_DISCOUNT_SHARE;
const OPX_MAX_UPGRADE_VALUE_USD = 60;

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
    user.syncWallet();
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
  user.syncWallet();

  return { upgradeCost, opxAmount, opxValue, usdtAmount };
}

module.exports = {
  OPX_INTERNAL_USD_PRICE,
  OPX_FUTURE_LISTING_USD_PRICE,
  OPX_MAX_UPGRADE_DISCOUNT_SHARE,
  OPX_MIN_USDT_UPGRADE_SHARE,
  OPX_MAX_UPGRADE_VALUE_USD,
  calculateOpxForUsd,
  applyOpxUpgradePayment
};