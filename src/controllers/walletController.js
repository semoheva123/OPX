const blockchainService = require('../services/blockchainService');
const { authenticator } = require('otplib');
const emailFrom = String(process.env.EMAIL_FROM || '').trim();

const verifySync = ({ token, secret }) => ({ valid: authenticator.check(token, secret) });
const realtimeService = require('../services/realtimeService');
const { withdrawalRequestTemplate } = require('../services/emailTemplates');
const { recordLedgerEntry } = require('../services/financialLedger');
const dataAccess = require('../services/dataAccess');
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
  try {
    const { amount, network, txHash } = req.body;
    const verifiedDeposit = await blockchainService.verifyDeposit(amount, network, txHash);
    const result = await dataAccess.callSupabaseRpc('operix_deposit_atomic', {
      p_user_id: req.user.id,
      p_amount: verifiedDeposit.amount,
      p_network: verifiedDeposit.network,
      p_tx_hash: verifiedDeposit.txHash,
      p_wallet_address: verifiedDeposit.config.depositAddress
    });
    const transaction = result.transaction;
    const wallet = result.wallet;
    await realtimeService.publish('user_data_changed', { reason: 'deposit_created', timestamp: new Date().toISOString() }, { userId: req.user.id });
    await realtimeService.publish('admin_transaction_created', { transactionId: transaction.id, type: 'deposit', userId: req.user.id }, { scope: 'admin' });
    return res.status(201).json({ success: true, message: 'تم التحقق من الإيداع وشحن رصيدك بنجاح', wallet, deposit: transaction, transaction });
  } catch (error) {
    if (error?.code === '23505' || error?.message === 'DUPLICATE_DEPOSIT') return res.status(409).json({ success: false, error: 'تمت معالجة هذه المعاملة مسبقاً' });
    if (error?.message?.startsWith('Invalid') || error?.message?.includes('Unsupported') || error?.message?.includes('does not match') || error?.message?.includes('not confirmed') || error?.message?.includes('not successful') || error?.message?.includes('not configured')) return res.status(400).json({ success: false, error: 'تعذر التحقق من المعاملة أو بياناتها غير صحيحة' });
    console.error('Supabase deposit error:', error.message);
    return res.status(500).json({ success: false, error: 'حدث خطأ في السيرفر أثناء تقديم الطلب' });
  }
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
    const { amount, walletAddress, twoFactorCode } = req.body;
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim().slice(0, 120);
    const withdrawNum = Number(amount);
    const feeSummary = calculateHybridWithdrawalFee(withdrawNum);
    if (!Number.isFinite(withdrawNum) || withdrawNum < MIN_WITHDRAWAL_AMOUNT) return res.status(400).json({ error: `الحد الأدنى للسحب هو ${MIN_WITHDRAWAL_AMOUNT}$ USDT` });
    if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });
    if (feeSummary.netAmount <= 0) return res.status(400).json({ error: 'مبلغ السحب غير صالح بعد احتساب الرسوم' });
    if (idempotencyKey) {
      const existing = await dataAccess.transaction.findOne({ userId: req.user.id, type: 'withdraw', idempotencyKey });
      if (existing) return res.json({ success: true, message: 'تم استلام طلب السحب مسبقًا', wallet: null, withdrawal: existing, duplicate: true });
    }
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (!user.emailVerified) return res.status(400).json({ error: 'يجب تأكيد بريدك الإلكتروني قبل طلب السحب' });
    if (user.kycStatus !== 'verified') return res.status(400).json({ error: `يجب إكمال توثيق الهوية قبل السحب. الحالة الحالية: ${user.kycStatus || 'not_started'}` });
    if (!user.twoFactorEnabled || !user.twoFactorSecret) return res.status(400).json({ error: 'يجب تفعيل المصادقة الثنائية قبل السحب' });
    if (!twoFactorCode || !verifySync({ token: String(twoFactorCode).trim(), secret: user.twoFactorSecret }).valid) return res.status(400).json({ error: 'رمز المصادقة الثنائية غير صحيح' });
    if (!user.walletAddress || user.walletAddress.trim() !== walletAddress.trim()) return res.status(400).json({ error: 'عنوان المحفظة لا يطابق العنوان المثبت في حسابك' });
    if (Number(user.wallet?.profitBalance || 0) < MIN_WITHDRAWAL_AMOUNT) return res.status(400).json({ error: `الحد الأدنى لرصيد الأرباح للسحب هو ${MIN_WITHDRAWAL_AMOUNT}$` });
    const vipLevel = await dataAccess.vipLevel.findOne({ code: user.tierCode });
    const maxLimit = vipLevel ? Math.max(20, Number(vipLevel.price || 0) * 0.3) : 20;
    if (withdrawNum > maxLimit) return res.status(400).json({ error: `الحد الأقصى للسحب الحالي هو ${maxLimit}$` });
    if (Number(user.wallet.profitBalance || 0) < withdrawNum) return res.status(400).json({ error: 'رصيد الأرباح غير كافٍ' });
    const weekStart = new Date(); weekStart.setUTCHours(0, 0, 0, 0); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const weekly = await dataAccess.transaction.find({ userId: req.user.id, type: 'withdraw', status: { $in: ['pending', 'approved'] }, createdAt: { $gte: weekStart } });
    if (weekly.reduce((sum, item) => sum + Number(item.amount || 0), 0) + withdrawNum > maxLimit) return res.status(400).json({ error: `تجاوزت الحد الأسبوعي للسحب البالغ ${maxLimit}$` });
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
      p_risk_flags: risk.riskFlags
    });
    const withdrawal = result.transaction;
    await realtimeService.publish('user_data_changed', { reason: 'withdrawal_created', timestamp: new Date().toISOString() }, { userId: req.user.id });
    await realtimeService.publish('admin_transaction_created', { transactionId: withdrawal.id, type: 'withdraw', userId: req.user.id, riskLevel: withdrawal.riskLevel, riskScore: withdrawal.riskScore }, { scope: 'admin' });
    return res.json({ success: true, message: 'تم تقديم طلب السحب بنجاح وإرسال التفاصيل لبريدك الإلكتروني', wallet: result.wallet, withdrawal });
  } catch (error) {
    if (error?.message === 'INSUFFICIENT_PROFIT') return res.status(400).json({ error: 'رصيد الأرباح غير كافٍ' });
    if (error?.code === '23505') return res.status(409).json({ success: true, message: 'تم استلام طلب السحب مسبقًا', duplicate: true });
    console.error('Supabase withdrawal error:', error.message);
    return res.status(500).json({ error: 'حدث خطأ في معالجة طلب السحب' });
  }
}

function getDepositConfig(req, res) {
  res.json({ addresses: blockchainService.getDepositAddresses() });
}

module.exports = { deposit, withdraw, getMyHistory, getDepositConfig };
