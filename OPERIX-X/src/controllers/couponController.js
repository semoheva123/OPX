const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { splitReward, applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');

async function apply(req, res) {
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
module.exports = { apply };
