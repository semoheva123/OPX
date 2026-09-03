const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

async function apply(req, res) {
  const session = await mongoose.startSession();
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'أدخل رمز الكوبون' });
    let coupon;
    await session.withTransaction(async () => {
      coupon = await Coupon.findOneAndUpdate({ code, active: true, $expr: { $lt: ['$usedCount', '$maxUses'] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }], usedBy: { $ne: req.user.id } }, { $inc: { usedCount: 1 }, $addToSet: { usedBy: req.user.id } }, { new: true, session });
      if (!coupon) throw Object.assign(new Error('INVALID_COUPON'), { statusCode: 400 });
      await User.findByIdAndUpdate(req.user.id, { $inc: { 'wallet.profitBalance': coupon.amount, 'wallet.balance': coupon.amount } }, { session });
      await new Transaction({ userId: req.user.id, type: 'reward', amount: coupon.amount, walletAddress: `Coupon ${coupon.code}`, status: 'approved' }).save({ session });
    });
    res.json({ success: true, amount: coupon.amount, message: `تمت إضافة مكافأة ${coupon.amount}$ إلى رصيد الأرباح` });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message === 'INVALID_COUPON' ? 'الكوبون غير صالح أو منتهي أو مستخدم سابقًا' : 'تعذر تطبيق الكوبون' }); }
  finally { await session.endSession(); }
}
module.exports = { apply };
