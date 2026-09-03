const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const VipLevel = require('../models/VipLevel');

async function getVipLevels(req, res) {
  try { res.json(await VipLevel.find().sort({ price: 1 })); }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function leaderboard(req, res) {
  try {
    const users = await User.find({ isBanned: false }).sort({ 'wallet.balance': -1 }).limit(10).select('email wallet.balance tierCode');
    const result = users.map((user, index) => {
      const [name, domain] = user.email.split('@');
      return { rank: index + 1, email: name.length > 3 ? `${name.substring(0, 3)}***@${domain}` : `***@${domain}`, balance: user.wallet?.balance || 0, tierCode: user.tierCode };
    });
    res.json({ success: true, leaderboard: result });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function liveActivity(req, res) {
  try {
    const [transactions, referrals] = await Promise.all([
      Transaction.find({ status: { $in: ['approved', 'completed'] } })
        .sort({ createdAt: -1 }).limit(20).select('userId type amount createdAt'),
      User.find({ referredBy: { $exists: true, $ne: null }, isBanned: false })
        .sort({ createdAt: -1 }).limit(20).select('email createdAt')
    ]);
    const transactionEvents = transactions.map(transaction => ({
      id: `transaction-${transaction._id}`,
      type: transaction.type,
      amount: Number(transaction.amount) || 0,
      createdAt: transaction.createdAt
    }));
    const referralEvents = referrals.map(user => ({
      id: `referral-${user._id}`,
      type: 'referral',
      amount: 0,
      createdAt: user.createdAt
    }));
    const events = [...transactionEvents, ...referralEvents]
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
      .slice(0, 20);
    res.json({ success: true, events });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل نشاط المنصة' }); }
}

async function upgrade(req, res) {
  const session = await mongoose.startSession();
  try {
    let user;
    let targetLevel;
    let upgradeCost;
    await session.withTransaction(async () => {
      user = await User.findById(req.user.id).session(session);
      if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
      const levels = await VipLevel.find().sort({ price: 1 }).session(session);
      const codes = levels.map(level => level.code);
      let nextCode = req.body.targetTier;
      if (!nextCode) {
        const index = codes.indexOf(user.tierCode);
        if (index < 0 || index === codes.length - 1) throw Object.assign(new Error('MAX_TIER'), { statusCode: 400 });
        nextCode = codes[index + 1];
      }
      targetLevel = levels.find(level => level.code === nextCode);
      if (!targetLevel) throw Object.assign(new Error('TIER_NOT_FOUND'), { statusCode: 400 });
      const currentIndex = codes.indexOf(user.tierCode);
      const targetIndex = codes.indexOf(targetLevel.code);
      const currentLevel = levels.find(level => level.code === user.tierCode);
      const currentActivated = Boolean(currentLevel && user.wallet.totalDeposits > 0);
      if (targetIndex < currentIndex || (targetIndex === currentIndex && currentActivated)) throw Object.assign(new Error('INVALID_TIER_ORDER'), { statusCode: 400 });
      if (targetIndex > currentIndex + 1) throw Object.assign(new Error('TIER_SEQUENCE'), { statusCode: 400 });
      const requiredReferrals = targetIndex * 10;
      const activeReferrals = await User.countDocuments({ referredBy: user.referralCode?.trim().toUpperCase(), isBanned: false, 'wallet.totalDeposits': { $gt: 0 } }).session(session);
      if (activeReferrals < requiredReferrals) throw Object.assign(new Error(`REFERRALS_REQUIRED:${requiredReferrals}:${activeReferrals}`), { statusCode: 400 });
      upgradeCost = targetIndex === currentIndex ? targetLevel.price : Math.max(0, targetLevel.price - (currentLevel?.price || 0));
      if (user.wallet.balance < upgradeCost) throw Object.assign(new Error(`INSUFFICIENT:${targetLevel.name}:${upgradeCost}:${user.wallet.balance}`), { statusCode: 400 });
      let remaining = upgradeCost;
      if (user.wallet.depositBalance >= remaining) user.wallet.depositBalance -= remaining;
      else { remaining -= user.wallet.depositBalance; user.wallet.depositBalance = 0; user.wallet.profitBalance -= remaining; }
      user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
      user.tierCode = targetLevel.code;
      await user.save({ session });
      await new Transaction({ userId: user._id, type: 'upgrade_deduction', amount: upgradeCost, walletAddress: `Upgrade to ${targetLevel.name} (${targetLevel.code})`, status: 'approved' }).save({ session });
      if (user.referredBy) {
        const referrer = await User.findOne({ referralCode: user.referredBy }).session(session);
        if (referrer) {
          const commission = parseFloat((upgradeCost * 0.1).toFixed(2));
          referrer.wallet.profitBalance += commission; referrer.wallet.balance = referrer.wallet.depositBalance + referrer.wallet.profitBalance;
          await referrer.save({ session });
          await new Transaction({ userId: referrer._id, type: 'referral_commission', amount: commission, walletAddress: `Commission from ${user.email}`, status: 'approved' }).save({ session });
        }
      }
    });
    res.json({ success: true, message: `تمت الترقية بنجاح إلى ${targetLevel.name} وتم خصم فرق السعر ${upgradeCost}$ من رصيدك.`, tierCode: user.tierCode, wallet: user.wallet, upgradeCost });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.statusCode === 404) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (err.message === 'MAX_TIER') return res.status(400).json({ error: 'أنت في المستوى الأقصى بالفعل' });
    if (err.message === 'TIER_NOT_FOUND') return res.status(400).json({ error: 'المستوى المطلوب غير موجود' });
    if (err.message === 'INVALID_TIER_ORDER') return res.status(400).json({ error: 'يمكنك الترقية فقط إلى مستوى أعلى من مستواك الحالي' });
    if (err.message === 'TIER_SEQUENCE') return res.status(400).json({ error: 'يجب إكمال المستويات بالترتيب، لا يمكنك تجاوز المستوى التالي' });
    if (err.message?.startsWith('REFERRALS_REQUIRED:')) { const [, required, active] = err.message.split(':'); return res.status(400).json({ error: `تحتاج إلى ${required} إحالة نشطة مرتبطة بفريقك للترقية. لديك حاليًا ${active} إحالة نشطة.` }); }
    if (err.message?.startsWith('INSUFFICIENT:')) { const [, name, price, balance] = err.message.split(':'); return res.status(400).json({ error: `رصيد المحفظة غير كافٍ للترقية إلى ${name}. المبلغ المطلوب: ${price}$، بينما رصيدك المتاح: ${balance}$` }); }
    console.error('Error during upgrade process:', err);
    res.status(500).json({ error: 'خطأ تقني أثناء معالجة الترقية' });
  } finally { await session.endSession(); }
}

module.exports = { getVipLevels, leaderboard, liveActivity, upgrade };
