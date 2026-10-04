const blockchainService = require('../services/blockchainService');
const { authenticator } = require('otplib');
const emailFrom = String(process.env.EMAIL_FROM || '').trim();

const verifySync = ({ token, secret }) => ({ valid: authenticator.check(token, secret) });
const realtimeService = require('../services/realtimeService');
const { withdrawalRequestTemplate } = require('../services/emailTemplates');
const { recordLedgerEntry } = require('../services/financialLedger');
const { hasFullFeatureAccess } = require('../services/paidFeatureAccess');
const dataAccess = require('../services/dataAccess');
const tronDepositService = require('../services/tronDepositService');
const SecurityEvent = dataAccess.securityEvent;

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

async function calculateWithdrawalRiskSupabase(user, amount, ip) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [failedLogins, newDevices, pendingWithdrawals] = await Promise.all([
    dataAccess.securityEvent.countDocuments({ userId: user.id || user._id, event: 'login_failed', createdAt: { $gte: since } }),
    dataAccess.securityEvent.countDocuments({ userId: user.id || user._id, event: 'new_device', createdAt: { $gte: since } }),
    dataAccess.transaction.countDocuments({ userId: user.id || user._id, type: 'withdraw', status: 'pending' })
  ]);
  const flags = [];
  let score = 0;
  if (amount >= 500) { score += 35; flags.push('large_amount'); }
  if (failedLogins > 0) { score += Math.min(25, failedLogins * 8); flags.push('failed_login_24h'); }
  if (newDevices > 0) { score += 25; flags.push('new_device_24h'); }
  if (pendingWithdrawals > 0) { score += 15; flags.push('pending_withdrawal'); }
  const riskScore = Math.min(100, score);
  return { riskScore, riskLevel: riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low', riskFlags: flags, ip };
}

async function deposit(req, res) {
  return depositSupabase(req, res);
}

async function depositSupabase(req, res) {
  return res.status(410).json({ success: false, error: 'أوقفنا إدخال TxHash اليدوي؛ تتم مطابقة الإيداعات تلقائيًا مع عنوان TRON المخصص لحسابك بعد تفعيل المراقبة.' });
}

async function getMyHistory(req, res) {
  try {
    const transactions = await dataAccess.transaction.find({ userId: req.user.id }, { sort: { createdAt: -1 } });
    res.status(200).json({ success: true, transactions });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function withdraw(req, res) {
  return withdrawSupabase(req, res);
}

async function withdrawSupabase(req, res) {
  try {
    const { amount, walletAddress, walletNetwork, twoFactorCode, asset, currency } = req.body;
    const requestedAsset = String(asset || currency || '').trim().toUpperCase();
    if (requestedAsset === 'OPX') {
      return res.status(400).json({ error: 'رصيد OPX الداخلي مخصص فقط للترقيات ولا يمكن سحبه.' });
    }
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim().slice(0, 120);
    const withdrawNum = Number(amount);
    const feeSummary = calculateHybridWithdrawalFee(withdrawNum);
    if (!Number.isFinite(withdrawNum) || withdrawNum < MIN_WITHDRAWAL_AMOUNT) return res.status(400).json({ error: `الحد الأدنى للسحب هو ${MIN_WITHDRAWAL_AMOUNT}$ USDT` });
    if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });
    if (String(walletNetwork || '').trim().toUpperCase() !== 'TRC20') return res.status(400).json({ error: 'السحب متاح حاليًا على شبكة TRC20 فقط' });
    if (feeSummary.netAmount <= 0) return res.status(400).json({ error: 'مبلغ السحب غير صالح بعد احتساب الرسوم' });
    if (idempotencyKey) {
      const existing = await dataAccess.transaction.findOne({ userId: req.user.id, type: 'withdraw', idempotencyKey });
      if (existing) return res.json({ success: true, message: 'تم استلام طلب السحب مسبقًا', wallet: null, withdrawal: existing, duplicate: true });
    }
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const fullFeatureAccess = hasFullFeatureAccess(user);
    if (!fullFeatureAccess && !user.emailVerified) return res.status(400).json({ error: 'يجب تأكيد بريدك الإلكتروني قبل طلب السحب' });
    if (!fullFeatureAccess && (!user.twoFactorEnabled || !user.twoFactorSecret)) return res.status(400).json({ error: 'يجب تفعيل المصادقة الثنائية قبل طلب السحب' });
    if (!fullFeatureAccess && (!twoFactorCode || !verifySync({ token: String(twoFactorCode).trim(), secret: user.twoFactorSecret }).valid)) return res.status(400).json({ error: 'رمز المصادقة الثنائية غير صحيح' });
    if (!fullFeatureAccess && (!user.walletAddress || user.walletAddress.trim() !== walletAddress.trim())) return res.status(400).json({ error: 'عنوان المحفظة لا يطابق العنوان المثبت في حسابك' });
    if (!fullFeatureAccess && String(user.walletNetwork || '').toUpperCase() !== String(walletNetwork).trim().toUpperCase()) return res.status(400).json({ error: 'شبكة السحب لا تطابق الشبكة المثبتة مع العنوان' });
    if (!fullFeatureAccess && Number(user.wallet?.profitBalance || 0) < MIN_WITHDRAWAL_AMOUNT) return res.status(400).json({ error: `الحد الأدنى لرصيد الأرباح للسحب هو ${MIN_WITHDRAWAL_AMOUNT}$` });
    const vipLevel = await dataAccess.vipLevel.findOne({ code: user.tierCode });
    const maxLimit = vipLevel ? Math.max(20, Number(vipLevel.price || 0) * 0.3) : 20;
    if (!fullFeatureAccess && withdrawNum > maxLimit) return res.status(400).json({ error: `الحد الأقصى للسحب الحالي هو ${maxLimit}$` });
    if (!fullFeatureAccess && Number(user.wallet.profitBalance || 0) < withdrawNum) return res.status(400).json({ error: 'رصيد الأرباح غير كافٍ' });
    const weekStart = new Date(); weekStart.setUTCHours(0, 0, 0, 0); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const weekly = await dataAccess.transaction.find({ userId: req.user.id, type: 'withdraw', status: { $in: ['pending', 'approved'] }, createdAt: { $gte: weekStart } });
    if (!fullFeatureAccess && weekly.reduce((sum, item) => sum + Number(item.amount || 0), 0) + withdrawNum > maxLimit) return res.status(400).json({ error: `تجاوزت الحد الأسبوعي للسحب البالغ ${maxLimit}$` });
    const risk = await calculateWithdrawalRiskSupabase(user, withdrawNum, req.ip);
    const result = await dataAccess.callSupabaseRpc('operix_withdraw_atomic', {
      p_user_id: req.user.id,
      p_amount: withdrawNum,
      p_fee: feeSummary.feeAmount,
      p_net_amount: feeSummary.netAmount,
      p_wallet_address: walletAddress.trim(),
      p_image_url: '',
      p_idempotency_key: idempotencyKey,
      p_risk_score: risk.riskScore,
      p_risk_level: risk.riskLevel,
      p_risk_flags: risk.riskFlags,
      p_network: String(walletNetwork).trim().toUpperCase()
    });
    const withdrawal = result.transaction;
    await realtimeService.publish('user_data_changed', { reason: 'withdrawal_created', timestamp: new Date().toISOString() }, { userId: req.user.id });
    await realtimeService.publish('admin_transaction_created', { transactionId: withdrawal.id, type: 'withdraw', userId: req.user.id, riskLevel: withdrawal.riskLevel, riskScore: withdrawal.riskScore }, { scope: 'admin' });
    const resend = req.app.locals.resend;
    let emailSent = false;
    if (resend && user.email && emailFrom) {
      try {
        const emailResult = await resend.emails.send({
          from: emailFrom,
          to: user.email,
          subject: 'تم استلام طلب السحب - OPERIX',
          html: withdrawalRequestTemplate({
            amount: withdrawNum.toFixed(2),
            transactionId: withdrawal.id,
            walletAddress: walletAddress.trim(),
            requestedAt: new Date().toLocaleString('ar')
          })
        });
        if (emailResult?.error) throw new Error(emailResult.error.message || 'Email provider rejected the request');
        emailSent = true;
      } catch (emailError) {
        console.error('Withdrawal request email failed:', emailError.message);
      }
    } else {
      console.error('Withdrawal request email skipped: email service is not configured');
    }
    return res.json({ success: true, emailSent, message: emailSent ? 'تم تقديم طلب السحب وإرسال إشعار إلى بريدك الإلكتروني' : 'تم تقديم طلب السحب، لكن تعذر إرسال إشعار البريد حاليًا', wallet: result.wallet, withdrawal });
  } catch (error) {
    if (error?.message === 'INSUFFICIENT_PROFIT') return res.status(400).json({ error: 'رصيد الأرباح غير كافٍ' });
    if (error?.code === '23505') return res.status(409).json({ success: true, message: 'تم استلام طلب السحب مسبقًا', duplicate: true });
    console.error('Supabase withdrawal error:', error.message);
    return res.status(500).json({ error: 'حدث خطأ في معالجة طلب السحب' });
  }
}

async function getDepositConfig(req, res) {
  try {
    if (String(process.env.TRON_DEPOSIT_AUTOMATION_ENABLED || '').toLowerCase() !== 'true') {
      return res.status(503).json({ success: false, error: 'الإيداع الآلي قيد التجهيز ولم يُفعّل بعد.' });
    }
    const address = await tronDepositService.ensureUserDepositAddress(req.user.id);
    return res.json({ success: true, network: 'TRC20', addresses: { TRC20: address }, automatic: true });
  } catch (error) {
    console.error('TRON deposit address provisioning failed:', error.message);
    const status = /NOT_CONFIGURED|REQUIRES_SUPABASE/.test(error.message) ? 503 : 500;
    return res.status(status).json({ success: false, error: status === 503 ? 'إعداد عنوان الإيداع الآلي غير مكتمل.' : 'تعذر تجهيز عنوان الإيداع الآن.' });
  }
}

module.exports = { deposit, withdraw, getMyHistory, getDepositConfig };
