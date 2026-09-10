const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Session = require('../models/Session');
const SecurityEvent = require('../models/SecurityEvent');
const Notification = require('../models/Notification');
const realtimeService = require('../services/realtimeService');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { emailVerificationTemplate, passwordResetTemplate, adminInviteTemplate } = require('../services/emailTemplates');
const { followOfficialCommunityAccount } = require('../services/officialCommunity');
const dataAccess = require('../services/dataAccess');

const verifySync = ({ token, secret }) => ({ valid: authenticator.check(token, secret) });
const generateSecret = () => authenticator.generateSecret();
const generateURI = ({ issuer, label, secret }) => authenticator.keyuri(label, issuer, secret);

const JWT_SECRET = process.env.JWT_SECRET;
const MAX_RESET_OTP_ATTEMPTS = 5;
const emailFrom = String(process.env.EMAIL_FROM || '').trim();

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `operix_admin=${encodeURIComponent(token)}; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function matchesHash(value, expected) {
  const actualBuffer = Buffer.from(hashOtp(value), 'hex');
  const expectedBuffer = Buffer.from(String(expected || ''), 'hex');
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function safeUser(user) {
  return {
    _id: user._id, email: user.email, emailVerified: user.emailVerified, role: user.role, tierCode: user.tierCode,
    assetWallet: user.assetWallet, todayCompletedTasks: user.todayCompletedTasks,
    referralCode: user.referralCode, referredBy: user.referredBy,
    walletAddress: user.walletAddress, isBanned: user.isBanned, wallet: user.wallet,
    USDT_balance: user.USDT_balance, OPX_balance: user.OPX_balance
  };
}

async function register(req, res) {
  try {
    const { email, password, referralCode, acceptTerms } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'جميع الحقول مطلوبة وبصيغة صحيحة' });
    if (acceptTerms !== true) return res.status(400).json({ error: 'يجب الموافقة على شروط الاستخدام وسياسة الخصوصية' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
    const cleanEmail = email.trim().toLowerCase();
    if (await dataAccess.user.findOne({ email: cleanEmail })) return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });

    let validReferralCode = null;
    if (typeof referralCode === 'string' && referralCode.trim()) {
      const referrer = await dataAccess.user.findOne({ referralCode: referralCode.trim().toUpperCase() });
      if (referrer) validReferralCode = referrer.referralCode;
    }
    const userPayload = {
      email: cleanEmail,
      password: await bcrypt.hash(password, 12),
      referralCode: `OPERIX${Date.now().toString(36).slice(-5).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      referredBy: validReferralCode,
      termsAcceptedAt: new Date(),
      emailVerificationToken: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
      emailVerificationExpire: new Date(Date.now() + 24 * 60 * 60 * 1000),
      wallet: { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 }
    };
    const newUser = dataAccess.isSupabaseRuntime() ? await dataAccess.user.create(userPayload) : new User(userPayload);
    if (!dataAccess.isSupabaseRuntime()) await newUser.save();
    if (!dataAccess.isSupabaseRuntime()) await followOfficialCommunityAccount(newUser._id);
    if (req.app.locals.resend) {
      const verifyUrl = `${process.env.APP_URL || 'http://localhost:5000'}/api/auth/verify-email?token=${newUser.emailVerificationToken}`;
      await req.app.locals.resend.emails.send({
        from: emailFrom,
        to: newUser.email,
        subject: 'تأكيد بريدك الإلكتروني - OPERIX',
        html: emailVerificationTemplate({ verifyUrl, userEmail: newUser.email })
      });
    }
    res.status(201).json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(400).json({ error: 'فشل في إنشاء الحساب' });
  }
}

async function verifyEmail(req, res) {
  try {
    const token = String(req.query.token || '').trim();
    const resultPage = (statusCode, title, message, actionText = 'العودة إلى OPERIX') => res.status(statusCode).send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - OPERIX</title></head><body style="margin:0;background:#060d18;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px"><main style="width:100%;max-width:520px;background:#0d1726;border:1px solid #26364b;border-radius:18px;padding:36px 28px;text-align:center;box-sizing:border-box"><div style="display:inline-block;background:#eeb34e;color:#08111e;font-size:22px;font-weight:700;letter-spacing:1px;padding:12px 18px;border-radius:10px;margin-bottom:24px">OPERIX</div><h1 style="margin:0 0 14px;font-size:26px">${title}</h1><p style="margin:0 0 26px;color:#cbd5e1;line-height:1.9">${message}</p><a href="/" style="display:inline-block;background:#eeb34e;color:#08111e;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:9px">${actionText}</a></main></body></html>`);
    if (!token) return resultPage(400, 'رابط التحقق غير صالح', 'يرجى طلب رابط توثيق جديد من قسم حسابي.');
    const user = await User.findOne({ emailVerificationToken: token, emailVerificationExpire: { $gt: new Date() } }).select('+emailVerificationToken +emailVerificationExpire');
    if (!user) return resultPage(400, 'الرابط غير صالح أو منتهي الصلاحية', 'يرجى طلب رابط توثيق جديد من قسم حسابي.');
    user.emailVerified = true; user.emailVerificationToken = null; user.emailVerificationExpire = null;
    await user.save();
    await SecurityEvent.create({ userId: user._id, email: user.email, event: 'email_verified', ip: req.ip, userAgent: req.get('user-agent') || 'unknown' });
    return resultPage(200, 'تم تأكيد البريد بنجاح', 'تم توثيق بريدك الإلكتروني ويمكنك الآن العودة إلى المنصة واستخدام جميع ميزات الحساب.');
  } catch (error) {
    console.error('Verify email error:', error.message);
    res.status(500).send('تعذر تأكيد البريد');
  }
}

async function resendVerification(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await User.findOne({ email }).select('+emailVerificationToken +emailVerificationExpire email emailVerified');
    if (!user || user.emailVerified) return res.json({ success: true, message: 'إذا كان الحساب يحتاج تحققًا، فسيصلك رابط جديد' });
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.emailVerificationExpire = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();
    if (req.app.locals.resend) {
      const verifyUrl = `${process.env.APP_URL || 'http://localhost:5000'}/api/auth/verify-email?token=${user.emailVerificationToken}`;
      const emailResult = await req.app.locals.resend.emails.send({
        from: emailFrom,
        to: user.email,
        subject: 'رابط تأكيد البريد - OPERIX',
        html: emailVerificationTemplate({ verifyUrl, userEmail: user.email })
      });
      if (emailResult?.error) {
        throw new Error(`Resend verification email failed: ${emailResult.error.message || 'provider rejected the email'}`);
      }
    } else {
      console.error('Resend verification email skipped: RESEND_API_KEY is not configured');
      return res.status(503).json({ error: 'خدمة البريد الإلكتروني غير مهيأة حاليًا' });
    }
    res.json({ success: true, message: 'تم إرسال رابط التحقق إذا كانت خدمة البريد مهيأة' });
  } catch (error) {
    console.error('Resend verification error:', error.message);
    res.status(502).json({ error: 'تعذر إرسال رابط توثيق البريد الإلكتروني. تحقق من إعدادات البريد أو حاول لاحقًا.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'يرجى إدخال البريد وكلمة المرور' });
    const user = await dataAccess.user.findOne({ email: email.trim().toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      try {
        await dataAccess.securityEvent.create({ email: email.trim().toLowerCase(), event: 'login_failed', ip: req.ip, userAgent: req.get('user-agent') || 'unknown' });
      } catch (securityError) {
        console.error('Failed to record login failure:', securityError.message);
      }
      return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    }
    if (user.isBanned) return res.status(403).json({ error: 'حسابك معطل حالياً من قبل الإدارة. يرجى التواصل مع الدعم.' });
    if (!user.wallet) user.wallet = { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 };
    if (user.wallet.depositBalance === undefined) user.wallet.depositBalance = 0;
    if (user.wallet.profitBalance === undefined) user.wallet.profitBalance = user.wallet.balance || 0;
    const wallet = user.wallet || { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 };
    wallet.depositBalance = Number(wallet.depositBalance || 0);
    wallet.profitBalance = Number(wallet.profitBalance ?? wallet.balance ?? 0);
    wallet.balance = Number((wallet.depositBalance + wallet.profitBalance).toFixed(2));
    user.wallet = wallet;
    user.USDT_balance = wallet.balance;
    user.lastLoginAt = new Date();
    if (dataAccess.isSupabaseRuntime()) {
      await dataAccess.user.updateOne({ id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });
    } else {
      user.syncWallet();
      await user.save();
    }
    const jti = crypto.randomUUID();
    const expiresInSeconds = 7 * 24 * 60 * 60;
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role, jti }, JWT_SECRET, { expiresIn: expiresInSeconds });
    const userAgent = req.get('user-agent') || 'unknown';
    const previousSession = dataAccess.isSupabaseRuntime()
      ? await dataAccess.session.findOne({ userId: user._id, revokedAt: null, ip: { $ne: req.ip }, userAgent: { $ne: userAgent }, expiresAt: { $gt: new Date() } })
      : await Session.findOne({ userId: user._id, revokedAt: null, ip: { $ne: req.ip }, userAgent: { $ne: userAgent }, expiresAt: { $gt: new Date() } }).select('_id');
    await dataAccess.session.create({ userId: user._id, jti, userAgent, ip: req.ip, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) });
    await dataAccess.securityEvent.create({ userId: user._id, email: user.email, event: 'login_success', ip: req.ip, userAgent });
    if (previousSession) {
      await dataAccess.securityEvent.create({ userId: user._id, email: user.email, event: 'new_device', ip: req.ip, userAgent, metadata: { reason: 'new_ip_and_user_agent' } });
      const notification = dataAccess.isSupabaseRuntime()
        ? await dataAccess.notification.create({ userId: user._id, title: 'تسجيل دخول من جهاز جديد', body: 'تم تسجيل الدخول إلى حسابك من جهاز أو شبكة مختلفة. راجع الجلسات النشطة إذا لم تكن هذه العملية منك.', type: 'security' })
        : await Notification.create({ userId: user._id, title: 'تسجيل دخول من جهاز جديد', body: 'تم تسجيل الدخول إلى حسابك من جهاز أو شبكة مختلفة. راجع الجلسات النشطة إذا لم تكن هذه العملية منك.', type: 'security' });
      realtimeService.emit('notification_created', { notificationId: notification._id, title: notification.title, type: notification.type }, { userId: user._id });
    }
    res.status(200).json({ success: true, token, user: safeUser(user) });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'حدث خطأ في تسجيل الدخول' });
  }
}

async function adminLogin(req, res) {
  try {
    const { email, password, twoFactorCode } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'يرجى إدخال البريد وكلمة المرور' });
    const user = dataAccess.isSupabaseRuntime()
      ? await dataAccess.user.findOne({ email: email.trim().toLowerCase() })
      : await User.findOne({ email: email.trim().toLowerCase() }).select('+adminTwoFactorSecret');
    const allowedRoles = ['admin', 'financial_admin', 'support_admin', 'monitor'];
    if (!user || !allowedRoles.includes(user.role) || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'بيانات الدخول الإدارية غير صحيحة' });
    if (user.isBanned) return res.status(403).json({ error: 'حساب الإدارة موقوف' });
    if (!user.adminTwoFactorEnabled || !user.adminTwoFactorSecret) return res.status(403).json({ error: 'يجب تفعيل Google Authenticator الخاص بالإدارة أولًا' });
    const normalizedTwoFactorCode = String(twoFactorCode || '').trim();
    if (!/^[0-9]{6}$/.test(normalizedTwoFactorCode)) return res.status(401).json({ error: 'رمز المصادقة الإدارية غير صحيح' });
    try {
      if (!verifySync({ token: normalizedTwoFactorCode, secret: user.adminTwoFactorSecret }).valid) return res.status(401).json({ error: 'رمز المصادقة الإدارية غير صحيح' });
    } catch (twoFactorError) {
      console.error('Admin 2FA verification error:', twoFactorError.message);
      return res.status(401).json({ error: 'إعداد المصادقة الإدارية غير صالح. أعد إعداد Google Authenticator.' });
    }
    const jti = crypto.randomUUID();
    const expiresInSeconds = 8 * 60 * 60;
    const userAgent = req.get('user-agent') || 'unknown';
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role, scope: 'admin', jti }, JWT_SECRET, { expiresIn: expiresInSeconds });
    await dataAccess.session.create({ userId: user._id, scope: 'admin', jti, userAgent, ip: req.ip, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) });
    await dataAccess.securityEvent.create({ userId: user._id, email: user.email, event: 'login_success', ip: req.ip, userAgent, metadata: { scope: 'admin' } });
    setAdminCookie(res, token);
    res.json({ success: true, token, user: { _id: user._id, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Admin login error:', error.message);
    res.status(500).json({ error: 'تعذر تسجيل الدخول إلى لوحة الإدارة' });
  }
}

function adminSession(req, res) {
  res.json({ success: true, user: { _id: req.user._id, email: req.user.email, role: req.user.role } });
}

async function adminSetupTwoFactor(req, res) {
  try {
    const { email, password } = req.body;
    const allowedRoles = ['admin', 'financial_admin', 'support_admin', 'monitor'];
    const user = await User.findOne({ email: String(email || '').trim().toLowerCase() }).select('+adminTwoFactorSecret');
    if (!user || !allowedRoles.includes(user.role) || !(await bcrypt.compare(String(password || ''), user.password))) return res.status(401).json({ error: 'بيانات المدير غير صحيحة' });
    if (user.adminTwoFactorEnabled && user.adminTwoFactorSecret) return res.status(400).json({ error: 'مصادقة الإدارة مفعلة بالفعل' });
    const secret = generateSecret();
    user.adminTwoFactorSecret = secret;
    await user.save();
    const otpauth = generateURI({ issuer: 'OPERIX Admin', label: user.email, secret });
    res.json({ success: true, secret, qrCode: await QRCode.toDataURL(otpauth), message: 'امسح QR ثم أدخل الرمز للتأكيد' });
  } catch (error) { res.status(500).json({ error: 'تعذر إعداد المصادقة الإدارية' }); }
}

async function adminConfirmTwoFactor(req, res) {
  try {
    const { email, password, code } = req.body;
    const user = await User.findOne({ email: String(email || '').trim().toLowerCase() }).select('+adminTwoFactorSecret');
    if (!user || !(await bcrypt.compare(String(password || ''), user.password)) || !user.adminTwoFactorSecret) return res.status(400).json({ error: 'بيانات الإعداد غير صالحة' });
    if (!/^[0-9]{6}$/.test(String(code || '').trim()) || !verifySync({ token: String(code).trim(), secret: user.adminTwoFactorSecret }).valid) return res.status(400).json({ error: 'رمز المصادقة غير صحيح' });
    user.adminTwoFactorEnabled = true;
    await user.save();
    await SecurityEvent.create({ userId: user._id, email: user.email, event: 'login_success', ip: req.ip, userAgent: req.get('user-agent') || 'unknown', metadata: { action: 'admin_2fa_enabled' } });
    res.json({ success: true, message: 'تم تفعيل مصادقة الإدارة. يمكنك الدخول الآن.' });
  } catch (error) { res.status(500).json({ error: 'تعذر تأكيد المصادقة الإدارية' }); }
}

async function adminSecurityStatus(req, res) {
  const user = dataAccess.isSupabaseRuntime()
    ? await dataAccess.user.findById(req.user.id)
    : await User.findById(req.user.id).select('adminTwoFactorEnabled');
  res.json({ success: true, enabled: Boolean(user?.adminTwoFactorEnabled) });
}

async function adminSecuritySetup(req, res) {
  try {
    const user = await User.findById(req.user.id).select('+adminTwoFactorSecret adminTwoFactorEnabled email');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.adminTwoFactorEnabled) return res.status(400).json({ error: 'مصادقة الإدارة مفعلة بالفعل' });
    const secret = generateSecret();
    user.adminTwoFactorSecret = secret;
    await user.save();
    const otpauth = generateURI({ issuer: 'OPERIX Admin', label: user.email, secret });
    res.json({ success: true, secret, qrCode: await QRCode.toDataURL(otpauth) });
  } catch (error) { res.status(500).json({ error: 'تعذر إنشاء رمز مصادقة الإدارة' }); }
}

async function adminSecurityConfirm(req, res) {
  try {
    const user = await User.findById(req.user.id).select('+adminTwoFactorSecret');
    if (!user || !user.adminTwoFactorSecret) return res.status(400).json({ error: 'ابدأ إعداد المصادقة أولًا' });
    if (!verifySync({ token: String(req.body.code || '').trim(), secret: user.adminTwoFactorSecret }).valid) return res.status(400).json({ error: 'رمز المصادقة غير صحيح' });
    user.adminTwoFactorEnabled = true;
    await user.save();
    res.json({ success: true, enabled: true, message: 'تم تفعيل مصادقة الإدارة بنجاح' });
  } catch (error) { res.status(500).json({ error: 'تعذر تفعيل مصادقة الإدارة' }); }
}

async function inviteAdmin(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || 'monitor');
    const allowedRoles = ['admin', 'financial_admin', 'support_admin', 'monitor'];
    if (!/^\S+@\S+\.\S+$/.test(email) || !allowedRoles.includes(role)) return res.status(400).json({ error: 'البريد أو الدور غير صالح' });
    const rawToken = crypto.randomBytes(32).toString('hex');
    let user = await User.findOne({ email }).select('+adminInviteToken +adminInviteExpire');
    if (!user) user = new User({ email, password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12), referralCode: `OPERIX${Date.now().toString(36).slice(-5).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}` });
    user.role = role; user.adminInviteToken = crypto.createHash('sha256').update(rawToken).digest('hex'); user.adminInviteExpire = new Date(Date.now() + 24 * 60 * 60 * 1000); user.adminInviteUsed = false; user.adminTwoFactorEnabled = false; user.adminTwoFactorSecret = null;
    await user.save();
    const inviteUrl = `${process.env.APP_URL || 'http://localhost:5000'}/admin-first-login.html?token=${rawToken}`;
    if (req.app.locals.resend) await req.app.locals.resend.emails.send({
      from: emailFrom,
      to: email,
      subject: 'دعوة دخول إدارة OPERIX',
      html: adminInviteTemplate({ inviteUrl, role })
    });
    res.status(201).json({ success: true, inviteUrl, message: req.app.locals.resend ? 'تم إرسال دعوة الدخول إلى البريد' : 'تم إنشاء الدعوة. انسخ الرابط وأرسله للمدير الجديد' });
  } catch (error) { res.status(500).json({ error: 'تعذر إنشاء دعوة المدير' }); }
}

async function acceptAdminInviteSetup(req, res) {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    const user = await User.findOne({ adminInviteToken: crypto.createHash('sha256').update(token).digest('hex'), adminInviteExpire: { $gt: new Date() }, adminInviteUsed: false }).select('+adminInviteToken +adminInviteExpire +adminTwoFactorSecret email role');
    if (!user) return res.status(400).json({ error: 'دعوة الإدارة غير صالحة أو منتهية' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
    user.password = await bcrypt.hash(password, 12); user.adminTwoFactorSecret = generateSecret();
    await user.save();
    const otpauth = generateURI({ issuer: 'OPERIX Admin', label: user.email, secret: user.adminTwoFactorSecret });
    res.json({ success: true, qrCode: await QRCode.toDataURL(otpauth), secret: user.adminTwoFactorSecret, message: 'امسح QR ثم أدخل الرمز لتفعيل الحماية' });
  } catch (error) { res.status(500).json({ error: 'تعذر إعداد دعوة الإدارة' }); }
}

async function confirmAdminInvite(req, res) {
  try {
    const token = String(req.body.token || '').trim();
    const user = await User.findOne({ adminInviteToken: crypto.createHash('sha256').update(token).digest('hex'), adminInviteExpire: { $gt: new Date() }, adminInviteUsed: false }).select('+adminInviteToken +adminInviteExpire +adminTwoFactorSecret email role');
    if (!user || !user.adminTwoFactorSecret) return res.status(400).json({ error: 'دعوة الإدارة غير صالحة أو لم يتم إعدادها' });
    if (!verifySync({ token: String(req.body.code || '').trim(), secret: user.adminTwoFactorSecret }).valid) return res.status(400).json({ error: 'رمز المصادقة غير صحيح' });
    user.adminTwoFactorEnabled = true; user.adminInviteUsed = true; user.adminInviteToken = null; user.adminInviteExpire = null; await user.save();
    res.json({ success: true, message: 'اكتمل إعداد حساب الإدارة. يمكنك تسجيل الدخول الآن.' });
  } catch (error) { res.status(500).json({ error: 'تعذر تأكيد دعوة الإدارة' }); }
}

async function logout(req, res) {
  if (req.session) await dataAccess.session.updateOne({ jti: req.session.jti, userId: req.user.id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (req.session?.scope === 'admin') res.setHeader('Set-Cookie', 'operix_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict');
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
}

async function logoutOtherSessions(req, res) {
  await dataAccess.session.updateMany({ userId: req.user.id, jti: { $ne: req.session?.jti }, revokedAt: null }, { $set: { revokedAt: new Date() } });
  res.json({ success: true, message: 'تم إنهاء الجلسات الأخرى بنجاح' });
}

async function revokeSession(req, res) {
  const jti = String(req.params.jti || '').trim();
  if (!jti || jti === req.session?.jti) return res.status(400).json({ error: 'لا يمكن إنهاء الجلسة الحالية من هنا' });
  const session = dataAccess.isSupabaseRuntime()
    ? await dataAccess.session.updateOne({ userId: req.user.id, scope: 'user', jti, revokedAt: null }, { $set: { revokedAt: new Date() } })
    : await Session.findOneAndUpdate({ userId: req.user.id, scope: 'user', jti, revokedAt: null }, { revokedAt: new Date() }, { new: true });
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة أو منتهية' });
  await SecurityEvent.create({ userId: req.user.id, email: req.user.email, event: 'session_revoked', ip: req.ip, userAgent: req.get('user-agent') || 'unknown', metadata: { revokedJti: jti } });
  res.json({ success: true, message: 'تم إنهاء الجلسة المحددة' });
}

async function listSessions(req, res) {
  const sessions = dataAccess.isSupabaseRuntime()
    ? await dataAccess.session.find({ userId: req.user.id, revokedAt: null, expiresAt: { $gt: new Date() } }, { sort: { createdAt: -1 }, select: 'jti userAgent ipAddress createdAt expiresAt' })
    : await Session.find({ userId: req.user.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).select('jti userAgent ip lastSeenAt createdAt expiresAt');
  res.json({ success: true, sessions: sessions.map(session => ({ ...(session.toObject ? session.toObject() : session), isCurrent: session.jti === req.session?.jti })) });
}

async function forgotPassword(req, res) {
  try {
    const resend = req.app.locals.resend;
    if (!req.body.email || typeof req.body.email !== 'string') return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني' });

    const email = req.body.email.trim().toLowerCase();
    const user = await dataAccess.user.findOne({ email });
    if (!user) return res.status(200).json({ success: true, message: 'إذا كان البريد مسجلاً، فستصلك تعليمات استعادة كلمة المرور' });

    const otp = crypto.randomInt(100000, 1000000).toString();
    if (dataAccess.isSupabaseRuntime()) {
      await dataAccess.user.updateOne({ id: user._id }, { $set: { metadata: {
        ...(user.metadata || {}), resetOtp: hashOtp(otp), resetOtpExpire: new Date(Date.now() + 10 * 60 * 1000), resetOtpAttempts: 0
      } } });
    } else {
      user.resetOTP = hashOtp(otp);
      user.resetOTPExpire = Date.now() + 10 * 60 * 1000;
      user.resetOTPAttempts = 0;
      await user.save();
    }

    if (resend) {
      try {
        await resend.emails.send({
      from: emailFrom,
      to: user.email,
      subject: 'رمز استعادة كلمة المرور - OPERIX',
      html: passwordResetTemplate({ otp, expiresInMinutes: 10 })
    });
        return res.json({ success: true, message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' });
      } catch (emailError) {
        console.error('Forgot password email send failed:', emailError.message);
      }
    }

    const isLocalDebug = process.env.NODE_ENV !== 'production' || process.env.DEBUG_RESET_OTP === 'true';
    const payload = {
      success: true,
      message: resend ? 'تم إنشاء رمز التحقق، ولكن فشل إرسال البريد. حاول مرة أخرى لاحقًا.' : 'خدمة البريد غير مهيأة في الخادم. تم إنشاء رمز التحقق محليًا لإجراء الاختبار.',
      devOtp: isLocalDebug ? otp : undefined
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم أثناء استعادة كلمة المرور' });
  }
}

async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body;
    const user = await dataAccess.user.findOne({ email: String(email || '').trim().toLowerCase() });
    const resetState = dataAccess.isSupabaseRuntime() ? (user?.metadata || {}) : user;
    const resetOtp = dataAccess.isSupabaseRuntime() ? resetState.resetOtp : resetState.resetOTP;
    const resetOtpExpire = dataAccess.isSupabaseRuntime() ? resetState.resetOtpExpire : resetState.resetOTPExpire;
    const resetOtpAttempts = Number(dataAccess.isSupabaseRuntime() ? resetState.resetOtpAttempts : resetState.resetOTPAttempts || 0);
    if (!user || !resetOtp || !resetOtpExpire || new Date(resetOtpExpire).getTime() <= Date.now() || resetOtpAttempts >= MAX_RESET_OTP_ATTEMPTS) return res.status(400).json({ error: 'رمز التحقق غير صحيح أو انتهت صلاحيته' });
    const valid = matchesHash(String(otp || ''), resetOtp);
    if (dataAccess.isSupabaseRuntime()) {
      await dataAccess.user.updateOne({ id: user._id }, { $set: { metadata: { ...(user.metadata || {}), resetOtpAttempts: resetOtpAttempts + 1 } } });
    } else {
      user.resetOTPAttempts = resetOtpAttempts + 1;
      await user.save();
    }
    if (!valid) return res.status(400).json({ error: 'رمز التحقق غير صحيح أو انتهت صلاحيته' });
    res.json({ success: true, message: 'رمز التحقق صحيح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف وجميع الحقول مطلوبة' });
    const user = await dataAccess.user.findOne({ email: email.trim().toLowerCase() });
    const resetState = dataAccess.isSupabaseRuntime() ? (user?.metadata || {}) : user;
    const resetOtp = dataAccess.isSupabaseRuntime() ? resetState.resetOtp : resetState.resetOTP;
    const resetOtpExpire = dataAccess.isSupabaseRuntime() ? resetState.resetOtpExpire : resetState.resetOTPExpire;
    const resetOtpAttempts = Number(dataAccess.isSupabaseRuntime() ? resetState.resetOtpAttempts : resetState.resetOTPAttempts || 0);
    if (!user || !resetOtp || !resetOtpExpire || new Date(resetOtpExpire).getTime() <= Date.now() || resetOtpAttempts >= MAX_RESET_OTP_ATTEMPTS) return res.status(400).json({ error: 'جلسة التغيير غير صالحة أو انتهت الصلاحية' });
    const nextAttempts = resetOtpAttempts + 1;
    if (!matchesHash(String(otp), resetOtp)) {
      if (dataAccess.isSupabaseRuntime()) await dataAccess.user.updateOne({ id: user._id }, { $set: { metadata: { ...(user.metadata || {}), resetOtpAttempts: nextAttempts } } });
      else { user.resetOTPAttempts = nextAttempts; await user.save(); }
      return res.status(400).json({ error: 'جلسة التغيير غير صالحة أو انتهت الصلاحية' });
    }
    if (dataAccess.isSupabaseRuntime()) {
      await dataAccess.user.updateOne({ id: user._id }, { $set: {
        password_hash: await bcrypt.hash(newPassword, 12),
        metadata: { ...(user.metadata || {}), resetOtp: null, resetOtpExpire: null, resetOtpAttempts: 0 }
      } });
    } else {
      user.password = await bcrypt.hash(newPassword, 12);
      user.resetOTP = null; user.resetOTPExpire = null; user.resetOTPAttempts = 0;
      await user.save();
    }
    await dataAccess.session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

module.exports = { register, login, adminLogin, adminSession, adminSetupTwoFactor, adminConfirmTwoFactor, adminSecurityStatus, adminSecuritySetup, adminSecurityConfirm, inviteAdmin, acceptAdminInviteSetup, confirmAdminInvite, logout, logoutOtherSessions, revokeSession, listSessions, verifyEmail, resendVerification, forgotPassword, verifyOtp, resetPassword };
