const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { splitReward, applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');
const dataAccess = require('../services/dataAccess');

async function apply(req, res) {
  if (dataAccess.isSupabaseRuntime()) return applySupabase(req, res);
  const session = await mongoose.startSession();
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'أدخل رمز الكوبون' });
    let coupon;
    await session.withTransaction(async () => {
      coupon = await Coupon.findOneAndUpdate({ code, active: true, $expr: { $lt: ['$usedCount', '$maxUses'] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }], usedBy: { $ne: req.user.id } }, { $inc: { usedCount: 1 }, $addToSet: { usedBy: req.user.id } }, { new: true, session });
      if (!coupon) throw Object.assign(new Error('INVALID_COUPON'), { statusCode: 400 });
      const user = await User.findById(req.user.id).session(session);
      if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
      const split = applyRewardToUser(user, coupon.amount);
      await user.save({ session });
      await new Transaction({ userId: req.user.id, type: 'reward', walletAddress: `Coupon ${coupon.code}`, status: 'approved', ...rewardTransactionFields(split) }).save({ session });
    });
    const split = splitReward(coupon.amount);
    res.json({ success: true, amount: coupon.amount, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount, message: `تم توزيع مكافأة ${coupon.amount}$ إلى ${split.usdtAmount} USDT و${split.opxAmount} OPX` });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message === 'INVALID_COUPON' ? 'الكوبون غير صالح أو منتهي أو مستخدم سابقًا' : error.message === 'USER_NOT_FOUND' ? 'المستخدم غير موجود' : 'تعذر تطبيق الكوبون' }); }
  finally { await session.endSession(); }
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
