// 🚀 OPERIX Platform Backend Server
// تم تحديث الكود وتطبيق أفضل الممارسات الأمنية وإدارة المعاملات المعقدة وفصل الأرباح عن الإيداع.

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const helmet = require('helmet');
const { Resend } = require('resend');
const Groq = require('groq-sdk');
const webpush = require('web-push');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const createApp = require('./src/app');
const User = require('./src/models/User');
const Transaction = require('./src/models/Transaction');
const Staking = require('./src/models/Staking');
const VipLevel = require('./src/models/VipLevel');
const GameSetting = require('./src/models/GameSetting');
const { connectDatabase, closeDatabase } = require('./src/config/database');
const { resetDailyTasks, scheduleDailyTaskReset } = require('./src/jobs/dailyTasksReset');
const { generateOfficialAiPost } = require('./src/jobs/aiAnnouncer');
const { processScheduledBroadcasts } = require('./src/controllers/adminController');
const {
  passwordResetTemplate,
  twoFactorTemplate,
  withdrawalRequestTemplate,
  withdrawalCompletedTemplate
} = require('./src/services/emailTemplates');


// 🔐 إعداد المفاتيح السرية وتجنب الثغرات الافتراضية
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ خطأ حرج: لم يتم تحديد JWT_SECRET في متغيرات البيئة!');
  process.exit(1);
}

// 📧 إعداد عميل Resend
const resendKey = process.env.RESEND_API_KEY;
const resend = resendKey ? new Resend(resendKey) : null;
const emailFrom = String(process.env.EMAIL_FROM || '').trim();
if (process.env.NODE_ENV === 'production' && (!emailFrom || /resend\.dev/i.test(emailFrom))) {
  console.error('Critical email configuration error: production EMAIL_FROM must use a verified custom domain.');
  process.exit(1);
}

// 🔔 إعداد مفاتيح Web Push (VAPID Keys)
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (publicVapidKey && privateVapidKey) {
  try {
    webpush.setVapidDetails(
      'mailto:support@operix.app',
      publicVapidKey,
      privateVapidKey
    );
  } catch (e) {
    console.warn('⚠️ خطأ في تهيئة Web Push VAPID:', e.message);
  }
}

// 🕹️ متغيرات إعدادات الألعاب
let gameSettings = {
  spinMin: 1,
  spinMax: 10,
  boxMin: 5,
  boxMax: 25,
  dailyGameRewardCap: 100
  , referralsPerCycle: 25
};
const app = createApp({
  resend,
  webpush,
  gameSettings,
  cronHandlers: {
    'reset-daily-tasks': resetDailyTasks,
    'ai-announcer': generateOfficialAiPost,
    'process-broadcasts': () => processScheduledBroadcasts(webpush)
  }
});

// دالة تهيئة مستويات VIP الافتراضية
async function seedVipLevels() {
  try {
    const count = await VipLevel.countDocuments();
    if (count === 0) {
      const defaultLevels = [
        { code: 'A1', name: 'المستوى A1 المعتمد', price: 50, tasks: 33, dailyProfit: 2.50, monthlyProfit: 75.00, yearlyProfit: 912.50, badgeColor: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' },
        { code: 'A2', name: 'المستوى A2 المتقدم', price: 150, tasks: 35, dailyProfit: 8.00, monthlyProfit: 240.00, yearlyProfit: 2920.00, badgeColor: 'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400' },
        { code: 'A3', name: 'المستوى A3 الخبير', price: 350, tasks: 40, dailyProfit: 20.00, monthlyProfit: 600.00, yearlyProfit: 7300.00, badgeColor: 'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400' },
        { code: 'A4', name: 'المستوى A4 المحترف', price: 750, tasks: 45, dailyProfit: 45.00, monthlyProfit: 1350.00, yearlyProfit: 16425.00, badgeColor: 'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400' },
        { code: 'A5', name: 'المستوى A5 الخارق (VIP)', price: 1500, tasks: 50, dailyProfit: 100.00, monthlyProfit: 3000.00, yearlyProfit: 36500.00, badgeColor: 'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400' }
      ];
      await VipLevel.insertMany(defaultLevels);
      console.log('🌟 تم إنشاء مستويات VIP الافتراضية بنجاح في قاعدة البيانات');
    }
  } catch (err) {
    console.error('⚠️ خطأ أثناء تهيئة مستويات VIP:', err.message);
  }
}

async function loadGameSettings() {
  let stored = await GameSetting.findOne({ key: 'default' });
  if (!stored) stored = await GameSetting.create({ key: 'default', spinMin: gameSettings.spinMin, spinMax: gameSettings.spinMax, boxMin: gameSettings.boxMin, boxMax: gameSettings.boxMax, dailyGameRewardCap: gameSettings.dailyGameRewardCap });
  Object.assign(gameSettings, { spinMin: stored.spinMin, spinMax: stored.spinMax, boxMin: stored.boxMin, boxMax: stored.boxMax, dailyGameRewardCap: stored.dailyGameRewardCap, referralsPerCycle: stored.referralsPerCycle || 25 });
}

async function migrateLegacyReferralCodes() {
  const legacyUsers = await User.find({ referralCode: /^BOOST/i }).select('_id referralCode').lean();
  if (!legacyUsers.length) return;
  const usedCodes = new Set(await User.find({ referralCode: /^OPERIX/i }).distinct('referralCode'));
  let migrated = 0;
  for (const user of legacyUsers) {
    let newCode;
    do {
      newCode = `OPERIX${Date.now().toString(36).slice(-5).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    } while (usedCodes.has(newCode));
    usedCodes.add(newCode);
    await User.updateOne({ _id: user._id, referralCode: user.referralCode }, { $set: { referralCode: newCode } });
    await User.updateMany({ referredBy: user.referralCode }, { $set: { referredBy: newCode } });
    migrated++;
  }
  console.log(`✅ تم تحديث ${migrated} كود إحالة قديم إلى OPERIX`);
}

// ==================== 4. المسارات العامة (Public & User APIs) ====================

/*
// 💎 مسار جلب قائمة مستويات VIP
app.get('/api/vip-levels', async (req, res) => {
  try {
    const levels = await VipLevel.find().sort({ price: 1 });
    res.status(200).json(levels);
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

/*
// 🤖 مسار المستشار الذكي (OPERIX AI Advisor)
app.post('/api/ai/chat', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ reply: 'يرجى كتابة سؤالك أولاً.' });
    }

    const user = await User.findById(req.user.id).select('-password');
    const userName = user ? user.email.split('@')[0] : 'المستخدم';
    const userBalance = user && user.wallet ? user.wallet.balance : 0;
    const userTier = user ? user.tierCode : 'A1';

    const cleanMessage = message.trim().toLowerCase();
    const flagKeywords = ['نصب', 'احتيال', 'سرقة', 'وهمي', 'فاشل', 'كذب', 'تزوير', 'حرام'];
    const isFlagged = flagKeywords.some(word => cleanMessage.includes(word));

    if (isFlagged) {
      return res.json({
        reply: `أهلاً بك يا ${userName}! جميع المعاملات في المنصة تشفر وتدار بتبعية عالية لضمان الأمان. نهدف دائماً لتوفير بيئة استثمارية آمنة ومربحة لجميع أعضائنا.`
      });
    }

    const apiKey = process.env.GROQ_API_KEY || process.env.Boostai;
    if (!apiKey) {
      console.error('❌ Groq API Key غير معرف في متغيرات البيئة.');
      return res.status(500).json({ reply: "المستشار الذكي غير متاح حالياً (مفتاح API غير معرف)." });
    }

    const groq = new Groq({ apiKey: apiKey.trim() });

    const systemPrompt = `
أنت "OPERIX AI Advisor"، المستشار الذكي والداعم الرسمي لمنصة OPERIX.
شخصيتك: احترافية، إيجابية جداً، مشجعة، وودودة.

معلومات العميل الحالي:
- الاسم: ${userName}
- الرصيد الحالي: ${userBalance}$
- المستوى الحالي: ${userTier}

قواعد الإجابة الصارمة:
1. أجب بشكل مباشر وديناميكي على سؤال المستخدم المحدد دون تكرار عبارات ترحيبية ثابتة.
2. اجعل الإجابة مختصرة ومفيدة (لا تتجاوز 2-3 جمل).
3. شجع المستخدم على إكمال المهام اليومية، الترقية للمستويات الأعلى، ودعوة الأصدقاء لزيادة أرباحه.
4. استخدم اللغة العربية الفصحى البسيطة.
`;

    const modelsToTry = [
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
      'qwen/qwen3.6-27b'
    ];

    let replyText = null;
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ],
          model: model,
          temperature: 0.7,
          max_tokens: 512,
          top_p: 1
        });

        replyText = completion.choices[0]?.message?.content;
        if (replyText) break;
      } catch (err) {
        console.warn(`⚠️ فشل الاتصال بالنموذج ${model}:`, err.message);
        lastError = err;
      }
    }

    if (replyText) {
      return res.json({ reply: replyText.trim() });
    } else {
      console.error('❌ خطأ Groq API التفصيلي:', lastError);
      return res.status(500).json({ reply: "عذراً، تعذر الحصول على رد من المستشار الذكي حالياً." });
    }
  } catch (error) {
    console.error('❌ خطأ في مسار /api/ai/chat:', error);
    return res.status(500).json({ reply: "حدث خطأ غير متوقع أثناء الاتصال بالمستشار الذكي." });
  }
});
*/

/*
// 🚀 مسار ترقية المستوى (تحديث الخصم الآمن من الرصيد المُودع ثم الأرباح)
app.post('/api/user/upgrade', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { targetTier } = req.body;
    
    const user = await User.findById(req.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const levels = await VipLevel.find().sort({ price: 1 }).session(session);
    const levelCodes = levels.map(l => l.code);

    let nextTierCode = targetTier;
    if (!nextTierCode) {
      const currentIndex = levelCodes.indexOf(user.tierCode);
      if (currentIndex === -1 || currentIndex === levelCodes.length - 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'أنت في المستوى الأقصى بالفعل' });
      }
      nextTierCode = levelCodes[currentIndex + 1];
    }

    const targetLevelData = levels.find(l => l.code === nextTierCode);
    if (!targetLevelData) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'المستوى المطلوب غير موجود' });
    }

    // 1. التحقق من كفاية الرصيد الإجمالي
    if (user.wallet.balance < targetLevelData.price) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        error: `رصيد المحفظة غير كافٍ للترقية إلى ${targetLevelData.name}. المبلغ المطلوب: ${targetLevelData.price}$، بينما رصيدك المتاح: ${user.wallet.balance}$` 
      });
    }

    // 2. خصم سعر الترقية: يُخصم أولوياً من رصيد الإيداع ثم من رصيد الأرباح
    let remainingPrice = targetLevelData.price;
    if (user.wallet.depositBalance >= remainingPrice) {
      user.wallet.depositBalance -= remainingPrice;
    } else {
      remainingPrice -= user.wallet.depositBalance;
      user.wallet.depositBalance = 0;
      user.wallet.profitBalance -= remainingPrice;
    }

    // 3. تحديث الرصيد الإجمالي ومستوى الحساب
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    user.tierCode = targetLevelData.code;
    await user.save({ session });

    // 4. تسجيل عملية الخصم في سجل المعاملات المالية
    const upgradeTx = new Transaction({
      userId: user._id,
      type: 'upgrade_deduction',
      amount: targetLevelData.price,
      walletAddress: `Upgrade to ${targetLevelData.name} (${targetLevelData.code})`,
      status: 'approved'
    });
    await upgradeTx.save({ session });

    // 5. منح العمولة للشخص الموصي (توزيع عمولة الإحالة)
    if (user.referredBy) {
      const referrer = await User.findOne({ referralCode: user.referredBy }).session(session);
      if (referrer) {
        const commissionAmount = parseFloat((targetLevelData.price * 0.10).toFixed(2));
        referrer.wallet.profitBalance += commissionAmount;
        referrer.wallet.balance = referrer.wallet.depositBalance + referrer.wallet.profitBalance;
        await referrer.save({ session });

        const commissionTx = new Transaction({
          userId: referrer._id,
          type: 'referral_commission',
          amount: commissionAmount,
          walletAddress: `Commission from ${user.email}`,
          status: 'approved'
        });
        await commissionTx.save({ session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ 
      success: true, 
      message: `تمت الترقية بنجاح إلى ${targetLevelData.name} وتم خصم ${targetLevelData.price}$ من رصيدك.`, 
      tierCode: user.tierCode,
      wallet: user.wallet
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error during upgrade process:', err);
    res.status(500).json({ error: 'خطأ تقني أثناء معالجة الترقية' });
  }
});
*/

/*
// 📌 مسار حفظ/تحديث عنوان محفظة السحب
app.post('/api/user/wallet-address', verifyToken, async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') {
      return res.status(400).json({ error: 'يرجى إدخال عنوان محفظة صالح' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (user.walletAddress && user.walletAddress.trim() !== '') {
      return res.status(400).json({ 
        error: 'عنوان المحفظة مثبت سابقاً، لا يمكنك تعديله إلا عن طريق التواصل مع الأدمن.' 
      });
    }

    user.walletAddress = walletAddress.trim();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم حفظ وتثبيت عنوان المحفظة بنجاح',
      walletAddress: user.walletAddress
    });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🌳 مسار جلب شجرة الفريق
app.get('/api/user/referrals', verifyToken, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const userCode = currentUser.referralCode ? currentUser.referralCode.trim().toUpperCase() : '';

    const referrals = await User.find({ 
      referredBy: userCode
    })
      .select('email tierCode createdAt wallet.balance')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      referralCode: currentUser.referralCode,
      referredBy: currentUser.referredBy || null,
      totalReferrals: referrals.length,
      referrals
    });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🔒 مسارات أمان التحقق الثنائي (2FA)
app.post('/api/user/2fa/send-code', verifyToken, async (req, res) => {
  try {
    if (!resend) return res.status(500).json({ error: 'خدمة البريد الإلكتروني غير مهيأة' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactorCode = code;
    user.twoFactorExpire = Date.now() + 5 * 60 * 1000;
    await user.save();

    await resend.emails.send({
      from: emailFrom,
      to: user.email,
      subject: 'رمز التحقق الثنائي (2FA) - OPERIX',
      html: twoFactorTemplate({ code, expiresInMinutes: 5 })
    });

    res.status(200).json({ success: true, message: 'تم إرسال رمز التحقق الثنائي إلى بريدك الإلكتروني' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إرسال الرمز' });
  }
});

// 🔔 مسار حفظ اشتراك الإشعارات الفورية
app.post('/api/push/subscribe', verifyToken, async (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'بيانات الاشتراك غير صالحة' });
    }

    await User.findByIdAndUpdate(req.user.id, { pushSubscription: subscription });
    res.status(201).json({ success: true, message: 'تم حفظ اشتراك الإشعارات بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

/*
// 📈 مسارات نظام التخزين المؤقت (Staking Pool)
app.post('/api/staking/create', verifyToken, async (req, res) => {
  try {
    const { amount, durationDays } = req.body;
    const stakeAmount = Number(amount);
    const duration = Number(durationDays);

    if (!stakeAmount || stakeAmount <= 0) {
      return res.status(400).json({ error: 'مبلغ التخزين غير صالح' });
    }

    if (![7, 15, 30].includes(duration)) {
      return res.status(400).json({ error: 'مدة التخزين المتاحة هي 7، 15، أو 30 يوماً فقط' });
    }

    let profitRate = 0.05;
    if (duration === 15) profitRate = 0.12;
    if (duration === 30) profitRate = 0.30;

    const expectedProfit = parseFloat((stakeAmount * profitRate).toFixed(2));

    const user = await User.findById(req.user.id);
    if (!user || user.wallet.balance < stakeAmount) {
      return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ لإنشاء حزمة التخزين' });
    }

    let remainingStake = stakeAmount;
    if (user.wallet.depositBalance >= remainingStake) {
      user.wallet.depositBalance -= remainingStake;
    } else {
      remainingStake -= user.wallet.depositBalance;
      user.wallet.depositBalance = 0;
      user.wallet.profitBalance -= remainingStake;
    }

    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    await user.save();

    const endDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

    const newStaking = new Staking({
      userId: user._id,
      amount: stakeAmount,
      durationDays: duration,
      profitRate,
      expectedProfit,
      endDate,
      status: 'active'
    });

    await newStaking.save();

    res.status(200).json({ success: true, message: 'تم تفعيل حزمة التخزين بنجاح', staking: newStaking });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

app.get('/api/staking/my', verifyToken, async (req, res) => {
  try {
    const stakings = await Staking.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, stakings });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

app.post('/api/staking/claim', verifyToken, async (req, res) => {
  try {
    const { stakingId } = req.body;
    const staking = await Staking.findOne({ _id: stakingId, userId: req.user.id });

    if (!staking) return res.status(404).json({ error: 'حزمة التخزين غير موجودة' });
    if (staking.status !== 'active') return res.status(400).json({ error: 'هذه الحزمة منتهية أو تم استلام أرباحها مسبقاً' });

    if (new Date() < new Date(staking.endDate)) {
      return res.status(400).json({ error: 'لم تنتهِ مدة التخزين المحددة بعد' });
    }

    staking.status = 'claimed';
    await staking.save();

    const user = await User.findById(req.user.id);
    user.wallet.depositBalance += staking.amount;
    user.wallet.profitBalance += staking.expectedProfit;
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    await user.save();

    const tx = new Transaction({
      userId: req.user.id,
      type: 'staking_reward',
      amount: staking.amount + staking.expectedProfit,
      walletAddress: 'Staking Pool Reward',
      status: 'approved'
    });
    await tx.save();

    res.status(200).json({ success: true, message: 'تم استلام رأس المال والأرباح بنجاح', wallet: user.wallet });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

/*
// 🏆 لوحة المتصدرين الحية
app.get('/api/leaderboard', async (req, res) => {
  try {
    const topUsers = await User.find({ isBanned: false })
      .sort({ 'wallet.balance': -1 })
      .limit(10)
      .select('email wallet.balance tierCode');

    const leaderboard = topUsers.map((u, index) => {
      const parts = u.email.split('@');
      const name = parts[0];
      const maskedEmail = name.length > 3 ? name.substring(0, 3) + '***@' + parts[1] : '***@' + parts[1];
      return {
        rank: index + 1,
        email: maskedEmail,
        balance: u.wallet ? u.wallet.balance : 0,
        tierCode: u.tierCode
      };
    });

    res.status(200).json({ success: true, leaderboard });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

/*
// 📝 تسجيل مستخدم جديد
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة وبصيغة صحيحة' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
    }

    let validReferralCode = null;
    if (referralCode && typeof referralCode === 'string' && referralCode.trim() !== '') {
      const cleanCode = referralCode.trim().toUpperCase();
      const referrerUser = await User.findOne({ referralCode: cleanCode });
      if (referrerUser) {
        validReferralCode = referrerUser.referralCode;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newReferralCode = ('OPERIX' + Date.now().toString().slice(-4) + Math.floor(10 + Math.random() * 90)).toUpperCase();

    const newUser = new User({ 
      email: cleanEmail, 
      password: hashedPassword, 
      referralCode: newReferralCode,
      referredBy: validReferralCode, 
      wallet: { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 }
    });
    
    await newUser.save();
    res.status(201).json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
  } catch (err) {
    res.status(400).json({ error: 'فشل في إنشاء الحساب' });
  }
});

// 🔑 تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'يرجى إدخال البريد وكلمة المرور' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'حسابك معطل حالياً من قبل الإدارة. يرجى التواصل مع الدعم.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    // مزامنة صحة الحقول المالية القديمة والجديدة
    if (user.wallet.depositBalance === undefined) user.wallet.depositBalance = 0;
    if (user.wallet.profitBalance === undefined) user.wallet.profitBalance = user.wallet.balance || 0;
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    await user.save();

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    
    const safeUser = {
      _id: user._id,
      email: user.email,
      role: user.role,
      tierCode: user.tierCode,
      assetWallet: user.assetWallet,
      todayCompletedTasks: user.todayCompletedTasks,
      referralCode: user.referralCode,
      referredBy: user.referredBy,
      walletAddress: user.walletAddress,
      isBanned: user.isBanned,
      wallet: user.wallet
    };

    res.status(200).json({ success: true, token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في تسجيل الدخول' });
  }
});

// 📩 طلب رمز استعادة كلمة المرور
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    if (!resend) return res.status(500).json({ error: 'خدمة البريد الإلكتروني غير مهيأة' });

    const { email } = req.body;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني' });

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(200).json({ success: true, message: 'إذا كان البريد مسجلاً، فستصلك تعليمات استعادة كلمة المرور' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    user.resetOTPExpire = Date.now() + 10 * 60 * 1000;
    await user.save();

    await resend.emails.send({
      from: emailFrom,
      to: user.email,
      subject: 'رمز استعادة كلمة المرور - OPERIX',
      html: passwordResetTemplate({ otp, expiresInMinutes: 10 })
    });

    res.status(200).json({ success: true, message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' });
  } catch (err) {
    res.status(500).json({ error: 'فشل إرسال البريد الإلكتروني' });
  }
});

// 🔍 التحقق من صحة الرمز
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp || typeof email !== 'string' || typeof otp !== 'string') {
      return res.status(400).json({ error: 'بيانات غير صالحة' });
    }

    const cleanEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: cleanEmail,
      resetOTP: otp,
      resetOTPExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'رمز التحقق غير صحيح أو انتهت صلاحيته' });
    }

    res.status(200).json({ success: true, message: 'رمز التحقق صحيح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🔄 إعادة تعيين كلمة المرور
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
    }

    const cleanEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: cleanEmail,
      resetOTP: otp,
      resetOTPExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'جلسة التغيير غير صالحة أو انتهت الصلاحية' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetOTP = null;
    user.resetOTPExpire = null;
    await user.save();

    res.status(200).json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

/*
// 👤 البروفايل
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -resetOTP -twoFactorCode');
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

/*
// ✅ إكمال المهام وتحديث الأرباح (محمية ضد Race Conditions)
app.post('/api/tasks/complete', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const user = await User.findById(req.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const vipLevel = await VipLevel.findOne({ code: user.tierCode }).session(session);
    const maxTasks = vipLevel ? vipLevel.tasks : 33;
    const dailyProfit = vipLevel ? vipLevel.dailyProfit : 2.50;
    const commission = parseFloat((dailyProfit / maxTasks).toFixed(4));

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user.id, todayCompletedTasks: { $lt: maxTasks } },
      {
        $inc: {
          assetWallet: commission,
          'wallet.profitBalance': commission,
          'wallet.balance': commission,
          todayCompletedTasks: 1
        }
      },
      { new: true, session }
    ).select('-password -resetOTP -twoFactorCode');

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'لقد أتممت جميع مهام اليوم' });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ 
      success: true, 
      assetWallet: updatedUser.assetWallet, 
      wallet: updatedUser.wallet, 
      completed: updatedUser.todayCompletedTasks 
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

/*
// 🎡 عجلة الحظ
app.post('/api/spin/wheel', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const min = gameSettings.spinMin ?? 1;
    const max = gameSettings.spinMax ?? 10;
    const rewardAmount = parseFloat((Math.random() * (max - min) + min).toFixed(2));

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { 
        $inc: { 
          'wallet.profitBalance': rewardAmount,
          'wallet.balance': rewardAmount 
        } 
      },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const rewardTransaction = new Transaction({
      userId: updatedUser._id,
      type: 'reward',
      amount: rewardAmount,
      walletAddress: 'Lucky Spin Wheel',
      status: 'approved'
    });
    await rewardTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ success: true, reward: rewardAmount, wallet: updatedUser.wallet });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🎁 الصندوق الغامض
app.post('/api/spin/mystery-box', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const min = gameSettings.boxMin ?? 5;
    const max = gameSettings.boxMax ?? 25;
    const rewardAmount = parseFloat((Math.random() * (max - min) + min).toFixed(2));

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { 
        $inc: { 
          'wallet.profitBalance': rewardAmount,
          'wallet.balance': rewardAmount 
        } 
      },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const rewardTransaction = new Transaction({
      userId: updatedUser._id,
      type: 'reward',
      amount: rewardAmount,
      walletAddress: 'Mystery Box',
      status: 'approved'
    });
    await rewardTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ success: true, reward: rewardAmount, wallet: updatedUser.wallet });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

/*
// 💸 طلب السحب (معدّل للتحقق والخصم من رصيد الأرباح فقط)
app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { amount, walletAddress, twoFactorCode } = req.body;
    const withdrawNum = Number(amount);

    if (!withdrawNum || withdrawNum < 20) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'الحد الأدنى للسحب هو 20$ USDT' });
    }

    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });
    }

    const user = await User.findById(req.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (!twoFactorCode || user.twoFactorCode !== twoFactorCode || !user.twoFactorExpire || user.twoFactorExpire < Date.now()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'رمز التحقق الثنائي (2FA) غير صحيح أو انتهت صلاحيته' });
    }

    const vipLevel = await VipLevel.findOne({ code: user.tierCode }).session(session);
    const maxLimit = vipLevel ? (vipLevel.price * 0.3) : 15;

    if (withdrawNum > maxLimit) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: `الحد الأقصى للسحب الأسبوعي لمستواك هو ${maxLimit}$` });
    }

    // ⭐ التحقق الحازم: الخصم التام والتحقق يكون من رصيد الأرباح فقط
    if (user.wallet.profitBalance < withdrawNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: `رصيد الأرباح القابل للسحب غير كافٍ. المتاح للسحب لديك هو: ${user.wallet.profitBalance}$ (رصيد الإيداع لا يمكن السحب منه).` });
    }

    // الخصم حصرياً من رصيد الأرباح
    user.wallet.profitBalance -= withdrawNum;
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    user.wallet.totalWithdrawn += withdrawNum;
    user.twoFactorCode = null;
    user.twoFactorExpire = null;
    await user.save({ session });

    const withdrawal = new Transaction({
      userId: user._id,
      type: 'withdraw',
      amount: withdrawNum,
      walletAddress: walletAddress.trim(),
      status: 'pending'
    });
    await withdrawal.save({ session });

    await session.commitTransaction();
    session.endSession();

    if (resend) {
      try {
        const formattedDate = new Date().toLocaleString('ar-EG', { timeZone: 'UTC' });
        await resend.emails.send({
          from: emailFrom,
          to: user.email,
          subject: 'تم تقديم طلب سحب جديد - OPERIX',
          html: withdrawalRequestTemplate({
            amount: withdrawNum,
            transactionId: withdrawal._id,
            walletAddress: walletAddress.trim(),
            requestedAt: formattedDate
          })
        });
      } catch (emailErr) {
        console.error('⚠️ فشل إرسال إشعار السحب عبر البريد:', emailErr.message);
      }
    }

    res.status(200).json({ success: true, message: 'تم تقديم طلب السحب بنجاح وإرسال التفاصيل لبريدك الإلكتروني', wallet: user.wallet });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});
*/

// ==================== 5. مسارات الإدارة (Admin APIs) ====================

// 🔐 صفحة لوحة التحكم الأدمين
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
/*
// 💎 إضافة أو تعديل مستوى VIP من الأدمن
app.post('/api/admin/vip-levels', verifyAdmin, async (req, res) => {
  try {
    const { code, name, price, tasks, dailyProfit, monthlyProfit, yearlyProfit, badgeColor } = req.body;

    if (!code || !name || price === undefined || !tasks || dailyProfit === undefined) {
      return res.status(400).json({ error: 'يرجى إدخال جميع البيانات الأساسية للمستوى' });
    }

    const levelData = {
      code: code.trim().toUpperCase(),
      name,
      price: Number(price),
      tasks: Number(tasks),
      dailyProfit: Number(dailyProfit),
      monthlyProfit: monthlyProfit ? Number(monthlyProfit) : (Number(dailyProfit) * 30),
      yearlyProfit: yearlyProfit ? Number(yearlyProfit) : (Number(dailyProfit) * 365),
      badgeColor: badgeColor || 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400'
    };

    const updatedLevel = await VipLevel.findOneAndUpdate(
      { code: levelData.code },
      levelData,
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'تم حفظ المستوى بنجاح', level: updatedLevel });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🗑️ حذف مستوى VIP من الأدمن
app.delete('/api/admin/vip-levels/:code', verifyAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const deleted = await VipLevel.findOneAndDelete({ code: code.toUpperCase() });
    if (!deleted) {
      return res.status(404).json({ error: 'المستوى غير موجود' });
    }
    res.json({ success: true, message: 'تم حذف المستوى بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 📊 الإحصائيات العامة
app.get('/api/admin/overview', verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
    
    const depositsResult = await Transaction.aggregate([
      { $match: { type: 'deposit', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const withdrawalsResult = await Transaction.aggregate([
      { $match: { type: 'withdraw', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalDeposits: depositsResult[0]?.total || 0,
        totalWithdrawals: withdrawalsResult[0]?.total || 0,
        pendingWithdrawals
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 👥 قائمة المستخدمين
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password -resetOTP -twoFactorCode').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🔄 مسار إعادة تعيين المهام اليومية
app.post('/api/admin/reset-daily-tasks', verifyAdmin, async (req, res) => {
  try {
    await User.updateMany({}, { $set: { todayCompletedTasks: 0 } });
    res.json({ success: true, message: 'تم إعادة تعيين المهام اليومية لجميع المستخدمين بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🚫 حظر أو إلغاء حظر مستخدم
app.post('/api/admin/users/toggle-ban', verifyAdmin, async (req, res) => {
  try {
    const { userId, isBanned } = req.body;
    const user = await User.findByIdAndUpdate(userId, { isBanned }, { new: true }).select('-password -resetOTP -twoFactorCode');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    res.json({
      success: true,
      message: isBanned ? 'تم حظر المستخدم بنجاح' : 'تم إلغاء حظر المستخدم بنجاح',
      user
    });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// ✏️ تعديل بيانات مستخدم من الإدارة
app.post('/api/admin/users/update', verifyAdmin, async (req, res) => {
  try {
    const { userId, depositBalance, profitBalance, tierCode, walletAddress } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (depositBalance !== undefined) user.wallet.depositBalance = Number(depositBalance);
    if (profitBalance !== undefined) user.wallet.profitBalance = Number(profitBalance);

    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    if (tierCode) user.tierCode = tierCode;
    if (walletAddress !== undefined) user.walletAddress = String(walletAddress).trim();

    await user.save();
    
    const safeUser = user.toObject();
    delete safeUser.password;
    delete safeUser.resetOTP;
    delete safeUser.twoFactorCode;

    res.json({ success: true, message: 'تم تعديل بيانات المستخدم بنجاح', user: safeUser });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 💸 جلب طلبات السحب والإيداع المعلقة
app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ type: { $in: ['withdraw', 'deposit'] } })
      .populate('userId', 'email tierCode')
      .sort({ createdAt: -1 });
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// ⚙️ الموافقة أو رفض طلب بـ ACID Transactions
app.post('/api/admin/withdrawals/action', verifyAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { transactionId, action } = req.body;
    const tx = await Transaction.findById(transactionId).populate('userId').session(session);
    if (!tx) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'المعاملة غير موجودة' });
    }

    if (tx.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'تمت معالجة هذه المعاملة سابقاً' });
    }

    const user = tx.userId;

    if (action === 'approve') {
      tx.status = 'approved';
      if (tx.type === 'deposit') {
        // تحويل مبلغ الإيداع تلقائياً لرصيد الإيداع حصراً
        await User.findByIdAndUpdate(user._id, {
          $inc: { 
            'wallet.depositBalance': tx.amount,
            'wallet.balance': tx.amount, 
            'wallet.totalDeposits': tx.amount 
          }
        }, { session });
      }

      if (tx.type === 'withdraw' && user && user.email && resend) {
        try {
          const completedDate = new Date().toLocaleString('ar-EG', { timeZone: 'UTC' });
          await resend.emails.send({
            from: emailFrom,
            to: user.email,
            subject: 'تم إتمام عملية السحب بنجاح - OPERIX',
            html: withdrawalCompletedTemplate({
              amount: tx.amount,
              transactionId: tx._id,
              walletAddress: tx.walletAddress,
              completedAt: completedDate
            })
          });
        } catch (emailErr) {
          console.error('⚠️ فشل إرسال بريد إتمام السحب:', emailErr.message);
        }
      }

    } else if (action === 'reject') {
      tx.status = 'rejected';
      if (tx.type === 'withdraw') {
        // إرجاع المبلغ لـ profitBalance في حال الرفض
        await User.findByIdAndUpdate(user._id, {
          $inc: { 
            'wallet.profitBalance': tx.amount, 
            'wallet.balance': tx.amount,
            'wallet.totalWithdrawn': -tx.amount 
          }
        }, { session });
      }
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'الإجراء المطلوب غير صالح' });
    }

    await tx.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.json({ success: true, message: `تمت عملية (${action === 'approve' ? 'الموافقة' : 'الرفض'}) بنجاح` });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 🎮 جلب إعدادات الألعاب
app.get('/api/admin/settings/games', verifyAdmin, async (req, res) => {
  res.json({ success: true, settings: gameSettings });
});

// 🎮 حفظ إعدادات الألعاب والعجلة
app.post('/api/admin/settings/games', verifyAdmin, async (req, res) => {
  try {
    const { spinMin, spinMax, boxMin, boxMax } = req.body;
    if (spinMin !== undefined) gameSettings.spinMin = Number(spinMin);
    if (spinMax !== undefined) gameSettings.spinMax = Number(spinMax);
    if (boxMin !== undefined) gameSettings.boxMin = Number(boxMin);
    if (boxMax !== undefined) gameSettings.boxMax = Number(boxMax);

    res.json({ success: true, message: 'تم حفظ إعدادات الألعاب بنجاح', settings: gameSettings });
  } catch (err) {
    res.status(500).json({ success: false, error: 'حدث خطأ في معالجة الطلب' });
  }
});

// 📢 مسار البث والإشعارات الفورية
app.post('/api/admin/broadcast', verifyAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'يرجى إدخال العنوان والنص' });
    }
    
    const usersWithPush = await User.find({ pushSubscription: { $ne: null } });
    const payload = JSON.stringify({ title, body });
    
    let sentCount = 0;
    for (const user of usersWithPush) {
      try {
        await webpush.sendNotification(user.pushSubscription, payload);
        sentCount++;
      } catch (pushErr) {
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          user.pushSubscription = null;
          await user.save();
        }
      }
    }

    res.json({ success: true, message: `تم إرسال البث والإشعارات الفورية بنجاح إلى (${sentCount}) مستخدماً` });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
});

// ==================== 6. تشغيل الخادم والإنهاء الآمن ====================
*/

const PORT = process.env.PORT || 5000;
let server;

connectDatabase()
  .then(async () => {
    await seedVipLevels();
    await loadGameSettings();
    await migrateLegacyReferralCodes();
    await Transaction.init();
    scheduleDailyTaskReset();
    setInterval(() => processScheduledBroadcasts(webpush).catch(error => console.error('Broadcast scheduler error:', error.message)), 60 * 1000);

    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 الخادم يعمل بنجاح على المنفذ: ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ خطأ حرج في الاتصال بقاعدة بيانات MongoDB:', err);
    process.exit(1);
  });

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ Uncaught Exception thrown:', error);
});

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  if (server) {
    server.close(() => {
      closeDatabase().then(() => {
        process.exit(0);
      });
    });
  } else {
    process.exit(0);
  }
});
