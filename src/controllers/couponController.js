const { splitReward, applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');
const dataAccess = require('../services/dataAccess');

async function apply(req, res) {
  return applySupabase(req, res);
}

async function applySupabase(req, res) {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'أدخل رمز الكوبون' });
    const coupon = await dataAccess.coupon.findOne({ code, active: true });
    if (!coupon || Number(coupon.usedCount || 0) >= Number(coupon.maxUses || 0) || (coupon.expiresAt && new Date(coupon.expiresAt) <= new Date())) return res.status(400).json({ error: 'الكوبون غير صالح أو منتهي أو مستخدم سابقًا' });
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const usedBy = Array.isArray(coupon.usedBy) ? coupon.usedBy : [];
    if (usedBy.map(String).includes(String(user.id || user._id))) return res.status(400).json({ error: 'الكوبون غير صالح أو منتهي أو مستخدم سابقًا' });
    const split = applyRewardToUser(user, coupon.amount);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance, OPX_balance: user.OPX_balance, assetWallet: user.assetWallet } });
    await dataAccess.coupon.updateOne({ id: coupon.id || coupon._id, usedCount: coupon.usedCount }, { $set: { usedCount: Number(coupon.usedCount || 0) + 1, usedBy: [...usedBy, user.id || user._id] } });
    await dataAccess.transaction.create({ userId: user.id || user._id, type: 'reward', walletAddress: `Coupon ${coupon.code}`, status: 'approved', ...rewardTransactionFields(split) });
    res.json({ success: true, amount: coupon.amount, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount, message: `تم توزيع مكافأة ${coupon.amount}$ إلى ${split.usdtAmount} USDT و${split.opxAmount} OPX` });
  } catch (error) {
    console.error('Supabase coupon error:', error.message);
    res.status(500).json({ error: 'تعذر تطبيق الكوبون' });
  }
}
module.exports = { apply };
