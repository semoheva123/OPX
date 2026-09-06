const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const VipLevel = require('../models/VipLevel');
const blockchainService = require('../services/blockchainService');
const { verifySync } = require('otplib');
const emailFrom = process.env.EMAIL_FROM || 'OPERIX <onboarding@resend.dev>';
const realtimeService = require('../services/realtimeService');
const SecurityEvent = require('../models/SecurityEvent');
const { withdrawalRequestTemplate } = require('../services/emailTemplates');

const HYBRID_WITHDRAWAL_RATE = 0.05;
const HYBRID_WITHDRAWAL_FIXED_FEE = 2;
const MIN_WITHDRAWAL_AMOUNT = 20;

function calculateHybridWithdrawalFee(amount) {
  const value = Number(amount);
  const feeAmount = Number((value * HYBRID_WITHDRAWAL_RATE + HYBRID_WITHDRAWAL_FIXED_FEE).toFixed(2));
  const netAmount = Number(Math.max(0, value - feeAmount).toFixed(2));
  return { feeAmount, netAmount };
}

async function calculateWithdrawalRisk(user, amount, ip, session) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [failedLogins, newDevices, pendingWithdrawals] = await Promise.all([
    SecurityEvent.countDocuments({ userId: user._id, event: 'login_failed', createdAt: { $gte: since } }).session(session),
    SecurityEvent.countDocuments({ userId: user._id, event: 'new_device', createdAt: { $gte: since } }).session(session),
    Transaction.countDocuments({ userId: user._id, type: 'withdraw', status: 'pending' }).session(session)
  ]);
  const flags = [];
  let score = 0;
  if (amount >= 500) { score += 35; flags.push('large_amount'); }
  if (failedLogins > 0) { score += Math.min(25, failedLogins * 8); flags.push('failed_login_24h'); }
  if (newDevices > 0) { score += 25; flags.push('new_device_24h'); }
  if (pendingWithdrawals > 0) { score += 15; flags.push('pending_withdrawal'); }
  const riskScore = Math.min(100, score);
  const riskLevel = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low';
  return { riskScore, riskLevel, riskFlags: flags, ip };
}

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

    await realtimeService.publish('user_data_changed', { reason: 'deposit_created', timestamp: new Date().toISOString() }, { userId: req.user.id });
    await realtimeService.publish('admin_transaction_created', { transactionId: depositTransaction._id, type: 'deposit', userId: req.user.id }, { scope: 'admin' });
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
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim().slice(0, 120);
    const withdrawNum = Number(amount);
    const feeSummary = calculateHybridWithdrawalFee(withdrawNum);
    if (!Number.isFinite(withdrawNum) || withdrawNum < MIN_WITHDRAWAL_AMOUNT) return res.status(400).json({ error: `الحد الأدنى للسحب هو ${MIN_WITHDRAWAL_AMOUNT}$ USDT` });
    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });
    if (feeSummary.netAmount <= 0) return res.status(400).json({ error: 'مبلغ السحب غير صالح بعد احتساب الرسوم' });
    if (idempotencyKey) {
      const existing = await Transaction.findOne({ userId: req.user.id, type: 'withdraw', idempotencyKey });
      if (existing) return res.json({ success: true, message: 'تم استلام طلب السحب مسبقًا', wallet: null, withdrawal: existing, duplicate: true });
    }

    session = await mongoose.startSession();
    let user;
    let withdrawal;
    await session.withTransaction(async () => {
      user = await User.findById(req.user.id).select('+twoFactorSecret').session(session);
      if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
      if (!user.emailVerified) throw Object.assign(new Error('EMAIL_UNVERIFIED'), { statusCode: 400 });
      if (user.kycStatus !== 'verified') throw Object.assign(new Error(`KYC_REQUIRED:${user.kycStatus || 'not_started'}`), { statusCode: 400 });
      if (!user.twoFactorEnabled) {
        throw Object.assign(new Error('TWO_FACTOR_REQUIRED'), { statusCode: 400 });
      }
      if (!twoFactorCode || !user.twoFactorSecret || !verifySync({ token: String(twoFactorCode).trim(), secret: user.twoFactorSecret }).valid) {
        throw Object.assign(new Error('INVALID_2FA'), { statusCode: 400 });
      }
      if (!user.walletAddress || user.walletAddress.trim() !== walletAddress.trim()) throw Object.assign(new Error('WALLET_MISMATCH'), { statusCode: 400 });
      if (user.wallet.profitBalance < MIN_WITHDRAWAL_AMOUNT) throw Object.assign(new Error(`MINIMUM_BALANCE:${MIN_WITHDRAWAL_AMOUNT}`), { statusCode: 400 });
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

      const risk = await calculateWithdrawalRisk(user, withdrawNum, req.ip, session);

      user.wallet.profitBalance -= withdrawNum;
      user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
      user.wallet.totalWithdrawn += withdrawNum;
      user.twoFactorCode = null;
      user.twoFactorExpire = null;
      await user.save({ session });
      withdrawal = new Transaction({
        userId: user._id,
        type: 'withdraw',
        amount: withdrawNum,
        feeAmount: feeSummary.feeAmount,
        netAmount: feeSummary.netAmount,
        walletAddress: walletAddress.trim(),
        idempotencyKey: idempotencyKey || undefined,
        status: 'pending',
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        riskFlags: risk.riskFlags
      });
      await withdrawal.save({ session });
      if (risk.riskLevel !== 'low') {
        await SecurityEvent.create([{ userId: user._id, email: user.email, event: 'withdrawal_risk', ip: req.ip, userAgent: req.get('user-agent') || 'unknown', metadata: { transactionId: withdrawal._id, riskScore: risk.riskScore, riskLevel: risk.riskLevel, riskFlags: risk.riskFlags } }], { session });
      }
    });

    const resend = req.app.locals.resend;
    if (resend) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: user.email,
          subject: 'تم تقديم طلب سحب جديد - منصة OPERIX',
          html: withdrawalRequestTemplate({
            amount: `${withdrawNum}`,
            transactionId: withdrawal._id,
            walletAddress: walletAddress.trim()
          })
        });
      } catch (emailErr) {
        console.error('فشل إرسال إشعار السحب عبر البريد:', emailErr.message);
      }
    }
    await realtimeService.publish('user_data_changed', { reason: 'withdrawal_created', timestamp: new Date().toISOString() }, { userId: user._id });
    await realtimeService.publish('admin_transaction_created', { transactionId: withdrawal._id, type: 'withdraw', userId: user._id, riskLevel: withdrawal.riskLevel, riskScore: withdrawal.riskScore }, { scope: 'admin' });
    res.status(200).json({ success: true, message: 'تم تقديم طلب السحب بنجاح وإرسال التفاصيل لبريدك الإلكتروني', wallet: user.wallet });
  } catch (err) {
    if (session && session.inTransaction()) await session.abortTransaction();
    if (err.statusCode === 404) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (err.message === 'EMAIL_UNVERIFIED') return res.status(400).json({ error: 'يجب تأكيد بريدك الإلكتروني قبل طلب السحب' });
    if (err.message?.startsWith('KYC_REQUIRED:')) {
      const kycStatus = err.message.split(':')[1];
      const message = kycStatus === 'pending' ? 'طلب توثيق هويتك قيد المراجعة. سيصبح السحب متاحًا بعد الاعتماد.' : kycStatus === 'rejected' ? 'تم رفض توثيق هويتك. حدّث وثائق KYC قبل طلب السحب.' : 'يجب توثيق هويتك قبل طلب السحب.';
      return res.status(400).json({ error: message, code: 'KYC_REQUIRED', kycStatus });
    }
    if (err.message === 'TWO_FACTOR_REQUIRED') return res.status(400).json({ error: 'يجب تفعيل Google Authenticator قبل تنفيذ السحب' });
    if (err.message === 'INVALID_2FA') return res.status(400).json({ error: 'رمز التحقق الثنائي (2FA) غير صحيح أو انتهت صلاحيته' });
    if (err.message === 'WALLET_MISMATCH') return res.status(400).json({ error: 'عنوان السحب يجب أن يطابق العنوان المثبت في قسم حسابي' });
    if (err.message?.startsWith('MAX_WITHDRAWAL:')) return res.status(400).json({ error: `الحد الأقصى للسحب الأسبوعي لمستواك هو ${err.message.split(':')[1]}$` });
    if (err.message?.startsWith('WEEKLY_WITHDRAWAL:')) return res.status(400).json({ error: `تجاوزت الحد الأسبوعي للسحب لمستواك وهو ${err.message.split(':')[1]}$` });
    if (err.message?.startsWith('MINIMUM_BALANCE:')) return res.status(400).json({ error: `لا يمكنك طلب السحب لأن رصيدك أقل من ${err.message.split(':')[1]}$` });
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
