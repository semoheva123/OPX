const User = require('../models/User');
const Transaction = require('../models/Transaction');
const VipLevel = require('../models/VipLevel');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { twoFactorTemplate } = require('../services/emailTemplates');

const generateSecret = () => authenticator.generateSecret();
const generateURI = ({ issuer, label, secret }) => authenticator.keyuri(label, issuer, secret);
const verifySync = ({ token, secret }) => ({ valid: authenticator.check(token, secret) });
const crypto = require('crypto');
const Session = require('../models/Session');
const { syncGameCredits } = require('../services/gameAccess');
const emailFrom = process.env.EMAIL_FROM || 'OPERIX <onboarding@resend.dev>';
const kycStorage = require('../services/kycStorage');

async function getProfile(req, res) {
  try {
    const user = await User.findById(req.user.id).select('-password -resetOTP -twoFactorCode');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await syncGameCredits(user, null, req.app.locals.gameSettings);
    await user.save();
    const referrals = await User.find({ referredBy: user.referralCode?.trim().toUpperCase() }).select('referralCode');
    const secondLevel = referrals.length
      ? await User.find({ referredBy: { $in: referrals.map(referral => referral.referralCode).filter(Boolean) } }).select('referralCode')
      : [];
    const thirdLevel = secondLevel.length
      ? await User.find({ referredBy: { $in: secondLevel.map(referral => referral.referralCode).filter(Boolean) } }).select('referralCode')
      : [];
    const teamStats = {
      l1: referrals.length,
      l2: secondLevel.length,
      l3: thirdLevel.length,
      activeReferrals: await User.countDocuments({ referredBy: user.referralCode?.trim().toUpperCase(), isBanned: false, 'wallet.totalDeposits': { $gt: 0 } })
    };
    teamStats.total = teamStats.l1 + teamStats.l2 + teamStats.l3;
    res.status(200).json({ success: true, user: { ...user.toObject(), teamStats } });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function setWalletAddress(req, res) {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) return res.status(400).json({ error: 'يرجى إدخال عنوان محفظة صالح' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.walletAddress && user.walletAddress.trim()) return res.status(400).json({ error: 'عنوان المحفظة مثبت سابقاً، لا يمكنك تعديله إلا عن طريق التواصل مع الأدمن.' });
    user.walletAddress = walletAddress.trim();
    await user.save();
    res.json({ success: true, message: 'تم حفظ وتثبيت عنوان المحفظة بنجاح', walletAddress: user.walletAddress });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function submitKyc(req, res) {
  try {
    const {
      fullName,
      documentType,
      documentNumber,
      country,
      documentUrl,
      documentImage
    } = req.body || {};

    const safeFullName = String(fullName || '').trim();
    const safeDocumentNumber = String(documentNumber || '').trim();
    const safeCountry = String(country || '').trim();
    const allowedDocumentTypes = ['national_id', 'passport', 'driver_license', 'residence_card'];

    if (!safeFullName || safeFullName.length < 2 || safeFullName.length > 80) {
      return res.status(400).json({ error: 'يرجى إدخال اسم كامل صحيح' });
    }

    if (!allowedDocumentTypes.includes(String(documentType || ''))) {
      return res.status(400).json({ error: 'نوع الوثيقة غير صالح' });
    }

    if (!safeDocumentNumber || safeDocumentNumber.length < 4 || safeDocumentNumber.length > 50) {
      return res.status(400).json({ error: 'رقم الوثيقة غير صالح' });
    }

    if (!safeCountry || safeCountry.length < 2 || safeCountry.length > 80) {
      return res.status(400).json({ error: 'يرجى تحديد الدولة' });
    }

    const rawDocumentReference = String(documentUrl || documentImage || '').trim();
    if (!rawDocumentReference) {
      return res.status(400).json({ error: 'يرجى إرفاق صورة أو رابط الوثيقة' });
    }

    let normalizedDocumentUrl = '';
    if (rawDocumentReference.startsWith('data:image/')) {
      if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(rawDocumentReference) || rawDocumentReference.length > 900000) {
        return res.status(400).json({ error: 'صورة الوثيقة يجب أن تكون JPG أو PNG أو WebP وألا تتجاوز 650 كيلوبايت' });
      }
      normalizedDocumentUrl = await kycStorage.store(rawDocumentReference);
      if (!normalizedDocumentUrl) return res.status(400).json({ error: 'تعذر حفظ صورة الوثيقة' });
    } else if (/^https?:\/\//i.test(rawDocumentReference)) {
      normalizedDocumentUrl = rawDocumentReference;
    } else {
      return res.status(400).json({ error: 'رابط أو صورة الوثيقة غير صالحة' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    user.kycFullName = safeFullName;
    user.kycDocumentType = String(documentType);
    user.kycDocumentNumber = safeDocumentNumber;
    user.kycCountry = safeCountry;
    user.kycDocumentUrl = normalizedDocumentUrl;
    user.kycStatus = 'pending';
    user.kycSubmittedAt = new Date();
    user.kycReviewedAt = null;
    user.kycNotes = '';
    user.kycReason = '';

    await user.save();

    res.json({
      success: true,
      message: 'تم إرسال طلب التوثيق بنجاح وسيتم مراجعته من الإدارة',
      user: {
        kycFullName: user.kycFullName,
        kycDocumentType: user.kycDocumentType,
        kycDocumentNumber: user.kycDocumentNumber,
        kycCountry: user.kycCountry,
        kycDocumentUrl: user.kycDocumentUrl,
        kycStatus: user.kycStatus,
        kycSubmittedAt: user.kycSubmittedAt
      }
    });
  } catch (err) {
    console.error('Submit KYC error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال طلب التوثيق' });
  }
}

async function updateProfileImage(req, res) {
  try {
    const { profileImage } = req.body;
    if (typeof profileImage !== 'string' || !profileImage.startsWith('data:image/')) {
      return res.status(400).json({ error: 'صيغة الصورة غير صالحة' });
    }
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(profileImage) || profileImage.length > 350000) {
      return res.status(400).json({ error: 'الصورة يجب أن تكون JPG أو PNG أو WebP وبحجم صغير' });
    }
    const user = await User.findByIdAndUpdate(req.user.id, { profileImage }, { new: true }).select('profileImage');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ success: true, profileImage: user.profileImage, message: 'تم حفظ الصورة الشخصية بنجاح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ أثناء حفظ الصورة الشخصية' }); }
}

async function getReferrals(req, res) {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const userCode = currentUser.referralCode?.trim().toUpperCase() || '';
    const referrals = await User.find({ referredBy: userCode }).select('email tierCode createdAt isBanned wallet.totalDeposits').sort({ createdAt: -1 }).limit(100).lean();
    const activeReferrals = referrals.filter(referral => !referral.isBanned && Number(referral.wallet?.totalDeposits || 0) > 0).length;
    res.json({ success: true, referralCode: currentUser.referralCode, referredBy: currentUser.referredBy || null, totalReferrals: referrals.length, activeReferrals, referrals });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function getTeamNetwork(req, res) {
  try {
    const currentUser = await User.findById(req.user.id).select('referralCode');
    if (!currentUser) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const levels = [];
    let parentCodes = [currentUser.referralCode?.trim().toUpperCase()].filter(Boolean);
    for (let level = 1; level <= 3; level++) {
      const members = await User.find({ referredBy: { $in: parentCodes } }).select('email tierCode createdAt isBanned wallet.totalDeposits referralCode').sort({ createdAt: -1 }).limit(300).lean();
      levels.push({ level, total: members.length, active: members.filter(member => !member.isBanned && Number(member.wallet?.totalDeposits || 0) > 0).length, members: members.map(member => ({ email: member.email, tierCode: member.tierCode, createdAt: member.createdAt, isBanned: member.isBanned, active: !member.isBanned && Number(member.wallet?.totalDeposits || 0) > 0, referralCode: member.referralCode })) });
      parentCodes = members.map(member => member.referralCode).filter(Boolean).map(code => code.trim().toUpperCase());
      if (!parentCodes.length) break;
    }
    res.json({ success: true, levels });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل شبكة الفريق' }); }
}

async function getGrowth(req, res) {
  try {
    const transactions = await Transaction.find({ userId: req.user.id, status: { $in: ['approved', 'completed'] } }).sort({ createdAt: 1 }).select('type amount createdAt').limit(100);
    let balance = 0;
    const points = transactions.map(transaction => {
      const amount = Number(transaction.amount) || 0;
      if (transaction.type === 'withdraw' || transaction.type === 'upgrade_deduction') balance -= amount;
      else balance += amount;
      return { date: transaction.createdAt, balance: Math.max(0, balance) };
    }).slice(-7);
    res.json({ success: true, points });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل مخطط نمو الحساب' }); }
}

async function getUpgradeHistory(req, res) {
  try {
    const history = await Transaction.find({ userId: req.user.id, type: 'upgrade_deduction' }).sort({ createdAt: -1 }).limit(30).select('amount walletAddress createdAt status').lean();
    res.json({ success: true, history });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل سجل الترقيات' }); }
}

async function getHomeSummary(req, res) {
  try {
    const user = await User.findById(req.user.id).select('-password -resetOTP -twoFactorCode');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const transactions = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(25).select('type amount status createdAt');
    const approvedTransactions = transactions.filter(transaction => ['approved', 'completed'].includes(transaction.status));
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const monthStart = new Date(todayStart); monthStart.setUTCDate(1);
    const earningsAggregate = await Transaction.aggregate([
      { $match: { userId: user._id, status: { $in: ['approved', 'completed'] }, type: { $in: ['deposit', 'reward', 'staking_reward', 'referral_commission'] } } },
      { $group: {
        _id: null,
        today: { $sum: { $cond: [{ $gte: ['$createdAt', todayStart] }, '$amount', 0] } },
        week: { $sum: { $cond: [{ $gte: ['$createdAt', weekStart] }, '$amount', 0] } },
        month: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, '$amount', 0] } }
      } }
    ]);
    const earnings = earningsAggregate[0] || { today: 0, week: 0, month: 0 };
    const pendingTransactions = transactions.filter(transaction => transaction.status === 'pending');
    const referralCount = await User.countDocuments({ referredBy: user.referralCode?.trim().toUpperCase() });
    const nextLevel = await VipLevel.findOne({ price: { $gt: user.wallet?.totalDeposits || 0 } }).sort({ price: 1 }).select('code name price dailyProfit tasks');
    const healthChecks = {
      email: Boolean(user.email),
      twoFactor: Boolean(user.twoFactorEnabled),
      wallet: Boolean(user.walletAddress?.trim()),
      deposit: Number(user.wallet?.totalDeposits) > 0,
      activity: approvedTransactions.length > 0
    };
    const health = Object.values(healthChecks).filter(Boolean).length * 20;
    const timeline = [
      { type: 'registered', date: user.createdAt, title: 'إنشاء الحساب' },
      ...approvedTransactions.slice(0, 6).map(transaction => ({ type: transaction.type, date: transaction.createdAt, amount: transaction.amount, title: transaction.type }))
    ].sort((first, second) => new Date(first.date) - new Date(second.date)).slice(-7);
    res.json({ success: true, summary: {
      todayEarned: Number(Number(earnings.today || 0).toFixed(2)),
      earnings: { today: Number(Number(earnings.today || 0).toFixed(2)), week: Number(Number(earnings.week || 0).toFixed(2)), month: Number(Number(earnings.month || 0).toFixed(2)) },
      health, healthChecks, referralCount,
      pendingTransactions: pendingTransactions.length,
      pendingByType: { deposits: pendingTransactions.filter(transaction => transaction.type === 'deposit').length, withdrawals: pendingTransactions.filter(transaction => transaction.type === 'withdraw').length },
      completedTasks: user.todayCompletedTasks || 0, teamStats: user.teamStats,
      nextLevel, timeline, recentActivity: approvedTransactions.slice(0, 10)
    }});
  } catch (err) {
    console.error('Home summary error:', err);
    res.status(500).json({ error: 'تعذر تحميل ملخص الرئيسية' });
  }
}

async function sendTwoFactorCode(req, res) {
  try {
    const resend = req.app.locals.resend;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (!user.twoFactorEnabled) return res.status(400).json({ error: 'فعّل المصادقة الثنائية أولاً من قسم حسابي' });

    const code = crypto.randomInt(100000, 1000000).toString();
    user.twoFactorCode = code;
    user.twoFactorExpire = Date.now() + 5 * 60 * 1000;
    await user.save();

    if (resend) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: user.email,
          subject: 'رمز التحقق الثنائي (2FA) - OPERIX',
          html: twoFactorTemplate({ code, expiresInMinutes: 5 })
        });
        return res.json({ success: true, message: 'تم إرسال رمز التحقق الثنائي إلى بريدك الإلكتروني' });
      } catch (emailError) {
        console.error('2FA email send failed:', emailError.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: resend ? 'تم إنشاء رمز التحقق، لكن إرسال البريد فشل.' : 'خدمة البريد غير مهيأة. تم إنشاء رمز التحقق محليًا للاختبار.',
      devCode: process.env.NODE_ENV !== 'production' || process.env.DEBUG_RESET_OTP === 'true' ? code : undefined
    });
  } catch (err) { res.status(500).json({ error: 'خطأ في إرسال الرمز' }); }
}

async function toggleTwoFactor(req, res) {
  try {
    if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'حالة المصادقة غير صالحة' });
    if (req.body.enabled) return res.status(400).json({ error: 'استخدم إعداد Google Authenticator ثم أكد الرمز أولاً' });
    const user = await User.findByIdAndUpdate(req.user.id, { twoFactorEnabled: req.body.enabled }, { new: true }).select('twoFactorEnabled');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ success: true, enabled: user.twoFactorEnabled, message: user.twoFactorEnabled ? 'تم تفعيل المصادقة الثنائية' : 'تم تعطيل المصادقة الثنائية' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في حفظ إعداد المصادقة' }); }
}

async function setupTwoFactor(req, res) {
  try {
    const user = await User.findById(req.user.id).select('+twoFactorSecret email');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.twoFactorEnabled) return res.status(400).json({ error: 'المصادقة الثنائية مفعلة بالفعل' });
    const secret = generateSecret();
    user.twoFactorSecret = secret;
    await user.save();
    const otpauth = generateURI({ issuer: 'OPERIX', label: user.email, secret });
    res.json({ success: true, qrCode: await QRCode.toDataURL(otpauth), secret });
  } catch (err) { res.status(500).json({ error: 'تعذر إعداد Google Authenticator' }); }
}

async function confirmTwoFactor(req, res) {
  try {
    const user = await User.findById(req.user.id).select('+twoFactorSecret');
    if (!user || !user.twoFactorSecret) return res.status(400).json({ error: 'ابدأ إعداد Google Authenticator أولاً' });
    if (!verifySync({ token: String(req.body.code || '').trim(), secret: user.twoFactorSecret }).valid) return res.status(400).json({ error: 'رمز Google Authenticator غير صحيح' });
    user.twoFactorEnabled = true;
    await user.save();
    res.json({ success: true, enabled: true, message: 'تم تفعيل Google Authenticator بنجاح' });
  } catch (err) { res.status(500).json({ error: 'تعذر تأكيد المصادقة الثنائية' }); }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف وجميع الحقول مطلوبة' });
    }
    const user = await User.findById(req.user.id);
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ أثناء تغيير كلمة المرور' }); }
}

async function subscribePush(req, res) {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'بيانات الاشتراك غير صالحة' });
    await User.findByIdAndUpdate(req.user.id, { pushSubscription: subscription });
    res.status(201).json({ success: true, message: 'تم حفظ اشتراك الإشعارات بنجاح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

module.exports = { getProfile, setWalletAddress, submitKyc, updateProfileImage, getReferrals, getTeamNetwork, getGrowth, getUpgradeHistory, getHomeSummary, sendTwoFactorCode, toggleTwoFactor, setupTwoFactor, confirmTwoFactor, changePassword, subscribePush };
