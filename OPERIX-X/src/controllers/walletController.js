const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const VipLevel = require('../models/VipLevel');
const blockchainService = require('../services/blockchainService');
const { verifySync } = require('otplib');

async function deposit(req, res) {
  let session;
  try {
    const { amount, network, txHash } = req.body;
    const verifiedDeposit = await blockchainService.verifyDeposit(amount, network, txHash);

    session = await mongoose.startSession();
    let depositTransaction;
    let updatedUser;

    await session.withTransaction(async () => {
      depositTransaction = new Transaction({
        userId: req.user.id,
        type: 'deposit',
        amount: verifiedDeposit.amount,
        walletAddress: verifiedDeposit.config.depositAddress,
        txHash: verifiedDeposit.txHash,
        network: verifiedDeposit.network,
        status: 'approved'
      });
      await depositTransaction.save({ session });

      updatedUser = await User.findByIdAndUpdate(req.user.id, {
        $inc: {
          'wallet.depositBalance': verifiedDeposit.amount,
          'wallet.balance': verifiedDeposit.amount,
          'wallet.totalDeposits': verifiedDeposit.amount
        }
      }, { new: true, session }).select('-password -resetOTP -twoFactorCode');

      if (!updatedUser) throw new Error('User not found while processing deposit');
    });

    res.status(201).json({ success: true, message: 'تم التحقق من الإيداع وشحن رصيدك بنجاح', wallet: updatedUser.wallet, deposit: depositTransaction, transaction: depositTransaction });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, error: 'تمت معالجة هذه المعاملة مسبقاً' });
    if (err?.message?.startsWith('Invalid') || err?.message?.includes('Unsupported') || err?.message?.includes('does not match') || err?.message?.includes('not confirmed') || err?.message?.includes('not successful') || err?.message?.includes('not configured')) {
      return res.status(400).json({ success: false, error: 'تعذر التحقق من المعاملة أو بياناتها غير صحيحة' });
    }
    console.error('Error processing deposit:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ في السيرفر أثناء تقديم الطلب' });
  } finally {
    if (session) await session.endSession();
  }
}

async function getMyHistory(req, res) {
  try {
    const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, transactions });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function withdraw(req, res) {
  let session;
  try {
    const { amount, walletAddress, twoFactorCode } = req.body;
    const withdrawNum = Number(amount);
    if (!Number.isFinite(withdrawNum) || withdrawNum < 20) return res.status(400).json({ error: 'الحد الأدنى للسحب هو 20$ USDT' });
    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });

    session = await mongoose.startSession();
    let user;
    let withdrawal;
    await session.withTransaction(async () => {
      user = await User.findById(req.user.id).select('+twoFactorSecret').session(session);
      if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
         if (!user.emailVerified) throw Object.assign(new Error('EMAIL_UNVERIFIED'), { statusCode: 400 });
      if (!user.twoFactorEnabled) {
        throw Object.assign(new Error('TWO_FACTOR_REQUIRED'), { statusCode: 400 });
      }
      if (!twoFactorCode || !user.twoFactorSecret || !verifySync({ token: String(twoFactorCode).trim(), secret: user.twoFactorSecret }).valid) {
        throw Object.assign(new Error('INVALID_2FA'), { statusCode: 400 });
      }
      if (!user.walletAddress || user.walletAddress.trim() !== walletAddress.trim()) throw Object.assign(new Error('WALLET_MISMATCH'), { statusCode: 400 });
      const vipLevel = await VipLevel.findOne({ code: user.tierCode }).session(session);
      const maxLimit = vipLevel ? Math.max(20, vipLevel.price * 0.3) : 20;
      if (withdrawNum > maxLimit) throw Object.assign(new Error(`MAX_WITHDRAWAL:${maxLimit}`), { statusCode: 400 });
      if (user.wallet.profitBalance < withdrawNum) throw Object.assign(new Error(`INSUFFICIENT_PROFIT:${user.wallet.profitBalance}`), { statusCode: 400 });
      const weekStart = new Date(); weekStart.setUTCHours(0, 0, 0, 0); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
      const weeklyWithdrawals = await Transaction.aggregate([
        { $match: { userId: user._id, type: 'withdraw', status: { $in: ['pending', 'approved'] }, createdAt: { $gte: weekStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).session(session);
      if ((weeklyWithdrawals[0]?.total || 0) + withdrawNum > maxLimit) throw Object.assign(new Error(`WEEKLY_WITHDRAWAL:${maxLimit}`), { statusCode: 400 });

      user.wallet.profitBalance -= withdrawNum;
      user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
      user.wallet.totalWithdrawn += withdrawNum;
      user.twoFactorCode = null;
      user.twoFactorExpire = null;
      await user.save({ session });
      withdrawal = new Transaction({ userId: user._id, type: 'withdraw', amount: withdrawNum, walletAddress: walletAddress.trim(), status: 'pending' });
      await withdrawal.save({ session });
    });

    const resend = req.app.locals.resend;
    if (resend) {
      try {
        await resend.emails.send({
          from: 'OPERIX <onboarding@resend.dev>',
          to: user.email,
          subject: 'تم تقديم طلب سحب جديد - منصة OPERIX',
          html: `<p>تم استلام طلب سحب بقيمة $${withdrawNum} USDT.</p><p>المعرف: ${withdrawal._id}</p><p>العنوان: ${walletAddress.trim()}</p>`
        });
      } catch (emailErr) {
        console.error('فشل إرسال إشعار السحب عبر البريد:', emailErr.message);
      }
    }
    res.status(200).json({ success: true, message: 'تم تقديم طلب السحب بنجاح وإرسال التفاصيل لبريدك الإلكتروني', wallet: user.wallet });
  } catch (err) {
    if (session && session.inTransaction()) await session.abortTransaction();
    if (err.statusCode === 404) return res.status(404).json({ error: 'المستخدم غير موجود' });
       if (err.message === 'EMAIL_UNVERIFIED') return res.status(400).json({ error: 'يجب تأكيد بريدك الإلكتروني قبل طلب السحب' });
       if (err.message === 'TWO_FACTOR_REQUIRED') return res.status(400).json({ error: 'يجب تفعيل Google Authenticator قبل تنفيذ السحب' });
    if (err.message === 'INVALID_2FA') return res.status(400).json({ error: 'رمز التحقق الثنائي (2FA) غير صحيح أو انتهت صلاحيته' });
    if (err.message === 'WALLET_MISMATCH') return res.status(400).json({ error: 'عنوان السحب يجب أن يطابق العنوان المثبت في قسم حسابي' });
    if (err.message?.startsWith('MAX_WITHDRAWAL:')) return res.status(400).json({ error: `الحد الأقصى للسحب الأسبوعي لمستواك هو ${err.message.split(':')[1]}$` });
    if (err.message?.startsWith('WEEKLY_WITHDRAWAL:')) return res.status(400).json({ error: `تجاوزت الحد الأسبوعي للسحب لمستواك وهو ${err.message.split(':')[1]}$` });
    if (err.message?.startsWith('INSUFFICIENT_PROFIT:')) return res.status(400).json({ error: `رصيد الأرباح القابل للسحب غير كافٍ. المتاح للسحب لديك هو: ${err.message.split(':')[1]}$ (رصيد الإيداع لا يمكن السحب منه).` });
    console.error('Error processing withdrawal:', err);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  } finally {
    if (session) await session.endSession();
  }
}

function getDepositConfig(req, res) {
  res.json({ addresses: blockchainService.getDepositAddresses() });
}

module.exports = { deposit, withdraw, getMyHistory, getDepositConfig };
