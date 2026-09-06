const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const VipLevel = require('../models/VipLevel');
const { applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');
const { OPX_INTERNAL_USD_PRICE, OPX_FUTURE_LISTING_USD_PRICE, OPX_MAX_UPGRADE_DISCOUNT_SHARE, OPX_MIN_USDT_UPGRADE_SHARE, calculateOpxForUsd, applyOpxUpgradePayment } = require('../services/opxPricing');

function getOpxPricing(req, res) {
  res.json({ symbol: 'OPX', internalUsdPrice: OPX_INTERNAL_USD_PRICE, futureListingUsdPrice: OPX_FUTURE_LISTING_USD_PRICE, upgradeRate: calculateOpxForUsd(1), maxUpgradeDiscountShare: OPX_MAX_UPGRADE_DISCOUNT_SHARE, minUsdtUpgradeShare: OPX_MIN_USDT_UPGRADE_SHARE });
}

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
    let payment;
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
      try { payment = applyOpxUpgradePayment(user, upgradeCost); }
      catch (error) { throw Object.assign(new Error(`INSUFFICIENT:${targetLevel.name}:${error.message.replace('INSUFFICIENT:', '')}`), { statusCode: 400 }); }
      user.tierCode = targetLevel.code;
      await user.save({ session });
      await new Transaction({ userId: user._id, type: 'upgrade_deduction', amount: payment.upgradeCost, grossAmount: payment.upgradeCost, usdtAmount: payment.usdtAmount, opxAmount: payment.opxAmount, walletAddress: `Upgrade to ${targetLevel.name} (${targetLevel.code})`, status: 'approved' }).save({ session });
      if (payment.opxAmount > 0) await new Transaction({ userId: user._id, type: 'token_burn', amount: payment.opxValue, grossAmount: payment.opxValue, opxAmount: payment.opxAmount, walletAddress: `Burn OPX for ${targetLevel.name} (${targetLevel.code})`, status: 'approved' }).save({ session });
      if (user.referredBy) {
        const referrer = await User.findOne({ referralCode: user.referredBy }).session(session);
        if (referrer) {
          const commission = parseFloat((payment.upgradeCost * 0.1).toFixed(2));
          const split = applyRewardToUser(referrer, commission);
          await referrer.save({ session });
          await new Transaction({ userId: referrer._id, type: 'referral_commission', walletAddress: `Commission from ${user.email}`, status: 'approved', ...rewardTransactionFields(split) }).save({ session });
        }
      }
    });
    res.json({ success: true, message: `تمت الترقية بنجاح إلى ${targetLevel.name}.`, tierCode: user.tierCode, wallet: user.wallet, OPX_balance: user.OPX_balance, upgradeCost, opxAmount: payment.opxAmount, usdtAmount: payment.usdtAmount });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.statusCode === 404) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (err.message === 'MAX_TIER') return res.status(400).json({ error: 'أنت في المستوى الأقصى بالفعل' });
    if (err.message === 'TIER_NOT_FOUND') return res.status(400).json({ error: 'المستوى المطلوب غير موجود' });
    if (err.message === 'INVALID_TIER_ORDER') return res.status(400).json({ error: 'يمكنك الترقية فقط إلى مستوى أعلى من مستواك الحالي' });
    if (err.message === 'TIER_SEQUENCE') return res.status(400).json({ error: 'يجب إكمال المستويات بالترتيب، لا يمكنك تجاوز المستوى التالي' });
    if (err.message?.startsWith('REFERRALS_REQUIRED:')) { const [, required, active] = err.message.split(':'); return res.status(400).json({ error: `تحتاج إلى ${required} إحالة نشطة مرتبطة بفريقك للترقية. لديك حاليًا ${active} إحالة نشطة.` }); }
    if (err.message?.startsWith('INSUFFICIENT:')) { const [, name, price, opxAmount, usdtAmount, balance] = err.message.split(':'); return res.status(400).json({ error: `رصيد الإيداع غير كافٍ للترقية إلى ${name}. المطلوب ${price}$، منها ${opxAmount} OPX محروقة و${usdtAmount}$ USDT نقدية، والمتاح ${balance}$ في رصيد الإيداع.` }); }
    console.error('Error during upgrade process:', err);
    res.status(500).json({ error: 'خطأ تقني أثناء معالجة الترقية' });
  } finally { await session.endSession(); }
}

module.exports = { getVipLevels, getOpxPricing, leaderboard, liveActivity, upgrade };
