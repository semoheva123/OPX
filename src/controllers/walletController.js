const crypto = require('crypto');
const emailFrom = String(process.env.EMAIL_FROM || '').trim();
const { TronWeb } = require('tronweb');
const QRCode = require('qrcode');

const realtimeService = require('../services/realtimeService');
const { withdrawalEmailCodeTemplate, withdrawalRequestTemplate } = require('../services/emailTemplates');
const { recordLedgerEntry } = require('../services/financialLedger');
const { hasFullFeatureAccess } = require('../services/paidFeatureAccess');
const withdrawalPayoutService = require('../services/withdrawalPayoutService');
const dataAccess = require('../services/dataAccess');
const { getTaskPeriodStarts } = require('../services/taskCalendar');
const tronDepositService = require('../services/tronDepositService');
const SecurityEvent = dataAccess.securityEvent;

const DEFAULT_MIN_WITHDRAWAL_AMOUNT = 20;
const ENTRY_TIER_MIN_WITHDRAWAL_AMOUNT = 10;
const WITHDRAWAL_EMAIL_CODE_TTL_MS = 10 * 60 * 1000;

function getMinimumWithdrawalAmount(tierCode) {
  return ['A1', 'A2'].includes(String(tierCode || '').trim().toUpperCase())
    ? ENTRY_TIER_MIN_WITHDRAWAL_AMOUNT
    : DEFAULT_MIN_WITHDRAWAL_AMOUNT;
}

function hashWithdrawalEmailCode(userId, code) {
  const secret = String(process.env.JWT_SECRET || '');
  if (secret.length < 32) throw new Error('WITHDRAWAL_EMAIL_CODE_SECRET_NOT_CONFIGURED');
  return crypto.createHmac('sha256', secret).update(`withdrawal-email-code:${userId}:${code}`).digest('hex');
}

function hashWithdrawalIntent({ userId, idempotencyKey, amount, walletAddress, network }) {
  const secret = String(process.env.JWT_SECRET || '');
  if (secret.length < 32) throw new Error('WITHDRAWAL_EMAIL_CODE_SECRET_NOT_CONFIGURED');
  const intent = JSON.stringify({ userId: String(userId), idempotencyKey, amount: Number(amount).toFixed(4), walletAddress, network });
  return crypto.createHmac('sha256', secret).update(`withdrawal-intent:${intent}`).digest('hex');
}

function calculateHybridWithdrawalFee(amount) {
  const match = String(amount ?? '').trim().match(/^(?:0|[1-9]\d*)(?:\.(\d{1,4}))?$/);
  if (!match) return { feeAmount: Number.NaN, netAmount: Number.NaN };
  const [whole, fraction = ''] = String(amount).trim().split('.');
  const amountUnits = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0') || '0');
  const feeUnits = (amountUnits * 10n) / 100n;
  const netUnits = amountUnits - feeUnits;
  return { feeAmount: Number(feeUnits) / 10000, netAmount: Number(netUnits) / 10000 };
}

function sameWithdrawalIntent(existing, intent) {
  return Number(existing?.amount) === intent.amount &&
    Number(existing?.feeAmount) === intent.feeAmount &&
    Number(existing?.netAmount) === intent.netAmount &&
    String(existing?.walletAddress || '').trim() === intent.walletAddress &&
    String(existing?.network || '').trim().toUpperCase() === intent.network;
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

async function recordDepositAudit(action, targetId, details = {}) {
  try {
    await dataAccess.auditLog.create({
      actorId: details.userId || null,
      action,
      entity: String(targetId || ''),
      metadata: details,
      createdAt: new Date()
    });
  } catch (error) {
    console.error(`Deposit audit entry failed (${action}):`, error.message);
  }
}

// A deposit may come from any wallet. This helper never blocks: it records the sender next to the
// balance change and flags differences so the finance team can review unusual funding patterns.
async function inspectDepositSender({ transfer, userId, transactionId }) {
  const reasons = [];
  // No pinned wallet means there is no baseline to compare against, so the deposit is not flagged.
  if (transfer.senderMatchesPinnedWallet === false) reasons.push('DEPOSIT_SENDER_DIFFERS_FROM_PINNED_WALLET');
  const senders = (transfer.senderAddresses || []).filter(Boolean);
  if (senders.length > 1) reasons.push('MULTIPLE_SENDERS_IN_ONE_TX');
  const flagged = reasons.length > 0;
  await recordDepositAudit(flagged ? 'deposit_sender_review' : 'deposit_sender_recorded', transfer.txHash, {
    userId,
    transactionId: transactionId || null,
    amount: transfer.amount,
    senderAddresses: senders,
    pinnedWalletAddress: transfer.pinnedWalletAddress,
    hasPinnedWallet: Boolean(transfer.pinnedWalletAddress),
    senderMatchesPinnedWallet: transfer.senderMatchesPinnedWallet,
    reasons
  });
  return { flagged, reasons };
}

async function deposit(req, res) {
  try {
    if (!dataAccess.isSupabaseRuntime()) return res.status(503).json({ success: false, error: 'خدمة الإيداع غير متاحة حاليًا.' });
    if (!await dataAccess.isSharedTronDepositSchemaReady()) return res.status(503).json({ success: false, error: 'تحديث خدمة الإيداع قيد التجهيز؛ لم يتم تسجيل العملية.' });
    const txHash = String(req.body?.txHash || '').trim().toLowerCase();
    const expectedAddress = tronDepositService.getSharedDepositAddress();
    // Deposits are allowed from any wallet: the sender is compared with the pinned withdrawal wallet
    // only to flag the deposit for a human review, never to reject it.
    const senderAddress = String((await dataAccess.user.findById(req.user.id).catch(() => null))?.walletAddress || '').trim();
    const transfer = await tronDepositService.verifySharedDepositTransfer(txHash, expectedAddress, senderAddress);
    const result = await dataAccess.callSupabaseRpc('operix_shared_tron_deposit_credit_atomic', {
      p_user_id: req.user.id,
      p_tx_hash: transfer.txHash,
      p_event_index: transfer.eventIndex,
      p_from_address: transfer.fromAddress,
      p_to_address: transfer.toAddress,
      p_amount: transfer.amount,
      p_block_timestamp: transfer.blockTimestamp
    });
    if (result?.duplicate) return res.status(409).json({ success: false, duplicate: true, error: 'تم تسجيل هذه المعاملة مسبقًا أو أنها قيد المراجعة.' });
    if (!result?.credited) throw new Error('SHARED_TRON_DEPOSIT_CREDIT_FAILED');
    const depositReview = await inspectDepositSender({ transfer, userId: req.user.id, transactionId: result.transaction?.id });
    try {
      await realtimeService.publish('user_data_changed', { reason: 'deposit_created', timestamp: new Date().toISOString() }, { userId: req.user.id });
      await realtimeService.publish('admin_transaction_created', { transactionId: result.transaction?.id, type: 'deposit', userId: req.user.id, senderReview: depositReview.flagged }, { scope: 'admin' });
    } catch (error) {
      console.error('TRON deposit realtime notification failed:', error.message);
    }
    await tronDepositService.sendDepositConfirmationEmail(req.app?.locals?.resend, req.user.id, result.transaction);
    return res.status(201).json({
      success: true,
      message: `تم تأكيد إيداع ${result.transaction?.amount || transfer.amount} USDT وإضافته إلى رصيدك.`,
      transaction: result.transaction,
      wallet: result.wallet,
      senderReview: { flagged: depositReview.flagged, reasons: depositReview.reasons }
    });
  } catch (error) {
    const messages = {
      INVALID_TRON_DEPOSIT_TX_HASH: 'أدخل TxID صحيحًا مكوّنًا من 64 خانة سداسية عشرية.',
      TRON_SHARED_DEPOSIT_ADDRESS_NOT_CONFIGURED: 'عنوان محفظة الإيداع غير مهيأ؛ لم يتم تسجيل أي عملية.',
      TRON_DEPOSIT_TRANSFER_NOT_FOUND_FOR_SHARED_ADDRESS: 'لم نعثر على تحويل USDT TRC20 مؤكد إلى عنوان الإيداع الرسمي بهذا TxID.',
      INVALID_TRON_DEPOSIT_AMOUNT: 'تعذر التحقق من مبلغ التحويل على الشبكة.',
      TRON_DEPOSIT_PRECISION_UNSUPPORTED: 'مبلغ التحويل يتجاوز دقة الرصيد المدعومة؛ تواصل مع الدعم قبل إعادة المحاولة.'
    };
    console.error('TRON TxID deposit verification failed:', error.message);
    return res.status(error.message === 'INVALID_TRON_DEPOSIT_TX_HASH' ? 400 : 422).json({ success: false, error: messages[error.message] || 'تعذر تأكيد التحويل على الشبكة؛ لم يُضف أي رصيد.' });
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
  let withdrawalIntent = null;
  try {
    const { amount, walletAddress, walletNetwork, emailCode, asset, currency } = req.body;
    const requestedAsset = String(asset || currency || '').trim().toUpperCase();
    if (requestedAsset && requestedAsset !== 'USDT') return res.status(400).json({ error: 'السحب متاح بعملة USDT فقط؛ رصيد OPX الداخلي غير قابل للسحب.' });
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) return res.status(400).json({ error: 'مفتاح طلب السحب غير صالح؛ أعد المحاولة من التطبيق.' });
    const amountText = (typeof amount === 'number' || typeof amount === 'string') ? String(amount).trim() : '';
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(amountText)) return res.status(400).json({ error: 'المبلغ يجب أن يكون رقمًا صالحًا حتى 4 منازل عشرية.' });
    const withdrawNum = Number(amountText);
    let maxPayoutAmount;
    try { maxPayoutAmount = withdrawalPayoutService.getMaxPayoutAmount(); }
    catch { return res.status(503).json({ error: 'إعداد الحد الأقصى للسحب غير صالح؛ لم يُحجز أي رصيد.' }); }
    const feeSummary = calculateHybridWithdrawalFee(amountText);
    if (!Number.isFinite(withdrawNum)) return res.status(400).json({ error: 'أدخل مبلغ سحب صالحًا.' });
    if (withdrawNum > maxPayoutAmount) return res.status(400).json({ error: 'المبلغ خارج النطاق المسموح للسحب' });
    if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });
    const normalizedWalletAddress = walletAddress.trim();
    const normalizedNetwork = String(walletNetwork || '').trim().toUpperCase();
    if (normalizedNetwork !== 'TRC20') return res.status(400).json({ error: 'السحب متاح حاليًا على شبكة TRC20 فقط' });
    if (!TronWeb.isAddress(normalizedWalletAddress)) return res.status(400).json({ error: 'عنوان محفظة TRON غير صالح.' });
    if (feeSummary.netAmount <= 0) return res.status(400).json({ error: 'مبلغ السحب غير صالح بعد احتساب الرسوم' });
    const intent = withdrawalIntent = { amount: withdrawNum, feeAmount: feeSummary.feeAmount, netAmount: feeSummary.netAmount, walletAddress: normalizedWalletAddress, network: normalizedNetwork };
    const existing = await dataAccess.transaction.findOne({ userId: req.user.id, type: 'withdraw', idempotencyKey });
    if (existing) {
      if (!sameWithdrawalIntent(existing, intent)) return res.status(409).json({ error: 'أُعيد استخدام مفتاح الطلب لبيانات سحب مختلفة؛ أنشئ طلبًا جديدًا.' });
      return res.json({ success: true, message: 'تم استلام طلب السحب مسبقًا', wallet: null, withdrawal: existing, duplicate: true });
    }
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const minimumWithdrawalAmount = getMinimumWithdrawalAmount(user.tierCode);
    if (withdrawNum < minimumWithdrawalAmount) return res.status(400).json({ error: `الحد الأدنى للسحب لمستوى ${user.tierCode || 'الحساب'} هو ${minimumWithdrawalAmount}$ USDT` });
    const fullFeatureAccess = hasFullFeatureAccess(user);
    if (!user.emailVerified) return res.status(400).json({ error: 'يجب تأكيد بريدك الإلكتروني قبل طلب السحب' });
    if (!user.walletAddress || String(user.walletAddress).trim() !== normalizedWalletAddress) return res.status(400).json({ error: 'عنوان المحفظة لا يطابق العنوان المثبت في حسابك' });
    if (String(user.walletNetwork || '').toUpperCase() !== normalizedNetwork) return res.status(400).json({ error: 'شبكة السحب لا تطابق الشبكة المثبتة مع العنوان' });
    if (!fullFeatureAccess && Number(user.wallet?.profitBalance || 0) < minimumWithdrawalAmount) return res.status(400).json({ error: `يلزم توفر ${minimumWithdrawalAmount}$ على الأقل في رصيد الأرباح لمستوى ${user.tierCode || 'الحساب'}.` });
    const vipLevel = await dataAccess.vipLevel.findOne({ code: user.tierCode });
    const maxLimit = vipLevel ? Math.max(20, Number(vipLevel.price || 0) * 0.3) : 20;
    if (!fullFeatureAccess && withdrawNum > maxLimit) return res.status(400).json({ error: `الحد الأقصى للسحب الحالي هو ${maxLimit}$` });
    if (!fullFeatureAccess && Number(user.wallet?.profitBalance || 0) < withdrawNum) return res.status(400).json({ error: 'رصيد الأرباح غير كافٍ' });
    const { weekStart } = getTaskPeriodStarts();
    const weekly = await dataAccess.transaction.find({ userId: req.user.id, type: 'withdraw', status: { $in: ['pending', 'approved'] }, createdAt: { $gte: weekStart } });
    if (!fullFeatureAccess && weekly.reduce((sum, item) => sum + Number(item.amount || 0), 0) + withdrawNum > maxLimit) return res.status(400).json({ error: `تجاوزت الحد الأسبوعي للسحب البالغ ${maxLimit}$` });

    const intentHash = hashWithdrawalIntent({ userId: req.user.id, idempotencyKey, amount: withdrawNum, walletAddress: normalizedWalletAddress, network: normalizedNetwork });
    const resend = req.app.locals.resend;
    if (!String(emailCode || '').trim()) {
      if (!resend?.emails?.send || !emailFrom) return res.status(503).json({ error: 'خدمة إرسال رمز تأكيد السحب إلى البريد غير متاحة حاليًا.' });
      const code = crypto.randomInt(100000, 1000000).toString();
      const issued = await dataAccess.callSupabaseRpc('operix_withdrawal_email_code_issue_atomic', {
        p_user_id: req.user.id,
        p_code_hash: hashWithdrawalEmailCode(req.user.id, code),
        p_intent_hash: intentHash,
        p_expires_at: new Date(Date.now() + WITHDRAWAL_EMAIL_CODE_TTL_MS).toISOString()
      });
      if (issued !== true) return res.status(429).json({ error: 'أُرسل رمز مؤخرًا. انتظر دقيقة قبل طلب رمز جديد.', code: 'WITHDRAWAL_EMAIL_CODE_COOLDOWN' });
      try {
        const emailResult = await resend.emails.send({
          from: emailFrom,
          to: user.email,
          subject: 'رمز تأكيد طلب السحب - OPERIX',
          html: withdrawalEmailCodeTemplate({ code, expiresInMinutes: 10, amount: withdrawNum.toFixed(4) })
        });
        if (emailResult?.error) throw new Error(emailResult.error.message || 'EMAIL_PROVIDER_REJECTED');
      } catch (emailError) {
        await dataAccess.callSupabaseRpc('operix_withdrawal_email_code_clear_atomic', { p_user_id: req.user.id, p_intent_hash: intentHash }).catch(() => {});
        console.error('Withdrawal email code send failed:', emailError.message);
        return res.status(502).json({ error: 'تعذر إرسال رمز السحب. لم يتم حجز أي رصيد؛ حاول مرة أخرى.' });
      }
      return res.status(202).json({
        success: true,
        verificationRequired: true,
        message: 'أرسلنا رمز تأكيد صالحًا لمدة 10 دقائق إلى بريدك الإلكتروني المسجل. أدخله لإكمال طلب السحب.',
        emailHint: String(user.email).replace(/^(.{1,2})[^@]*/, '$1•••')
      });
    }

    const normalizedEmailCode = String(emailCode).trim();
    if (!/^[0-9]{6}$/.test(normalizedEmailCode)) return res.status(400).json({ error: 'أدخل رمز البريد المكوّن من 6 أرقام.' });
    const codeAccepted = await dataAccess.callSupabaseRpc('operix_withdrawal_email_code_consume_atomic', {
      p_user_id: req.user.id,
      p_code_hash: hashWithdrawalEmailCode(req.user.id, normalizedEmailCode),
      p_intent_hash: intentHash
    });
    if (codeAccepted !== true) return res.status(400).json({ error: 'رمز البريد غير صحيح أو منتهي أو مرتبط بتفاصيل سحب مختلفة.' });

    const risk = await calculateWithdrawalRiskSupabase(user, withdrawNum, req.ip);
    const result = await dataAccess.callSupabaseRpc('operix_withdraw_atomic', {
      p_user_id: req.user.id,
      p_amount: withdrawNum,
      p_fee: feeSummary.feeAmount,
      p_net_amount: feeSummary.netAmount,
      p_wallet_address: normalizedWalletAddress,
      p_image_url: '',
      p_idempotency_key: idempotencyKey,
      p_risk_score: risk.riskScore,
      p_risk_level: risk.riskLevel,
      p_risk_flags: risk.riskFlags,
      p_network: normalizedNetwork
    });
    const withdrawal = result.transaction;
    if (result.duplicate) {
      if (!sameWithdrawalIntent(withdrawal, intent)) return res.status(409).json({ error: 'أُعيد استخدام مفتاح الطلب لبيانات سحب مختلفة؛ أنشئ طلبًا جديدًا.' });
      return res.json({ success: true, message: 'تم استلام طلب السحب مسبقًا', wallet: null, withdrawal, duplicate: true });
    }
    await realtimeService.publish('user_data_changed', { reason: 'withdrawal_created', timestamp: new Date().toISOString() }, { userId: req.user.id });
    await realtimeService.publish('admin_transaction_created', { transactionId: withdrawal.id, type: 'withdraw', userId: req.user.id, riskLevel: withdrawal.riskLevel, riskScore: withdrawal.riskScore }, { scope: 'admin' });
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
            walletAddress: normalizedWalletAddress,
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
    if (error?.message === 'WITHDRAWAL_EMAIL_CODE_SECRET_NOT_CONFIGURED') return res.status(503).json({ error: 'خدمة تأكيد السحب غير مهيأة بأمان؛ لم يُحجز أي رصيد.' });
    if (error?.message === 'INSUFFICIENT_PROFIT') return res.status(400).json({ error: 'رصيد الأرباح غير كافٍ' });
    if (error?.message === 'WITHDRAWAL_DAY_NOT_ALLOWED') return res.status(503).json({ success: false, code: 'WITHDRAWAL_SCHEDULE_UPDATE_REQUIRED', error: 'يلزم تطبيق تحديث إتاحة السحب اليومي على قاعدة البيانات؛ لم يُحجز أي رصيد. حاول مرة أخرى بعد اكتمال التحديث.' });
    if (error?.message === 'IDEMPOTENCY_KEY_REUSED') return res.status(409).json({ error: 'أُعيد استخدام مفتاح الطلب لبيانات سحب مختلفة؛ أنشئ طلبًا جديدًا.' });
    if (error?.code === '23505') {
      try {
        const existing = await dataAccess.transaction.findOne({ userId: req.user.id, type: 'withdraw', idempotencyKey: String(req.get('Idempotency-Key') || '').trim() });
        if (existing && withdrawalIntent && sameWithdrawalIntent(existing, withdrawalIntent)) {
          return res.json({ success: true, message: 'تم استلام طلب السحب مسبقًا', withdrawal: existing, duplicate: true });
        }
      } catch { }
      return res.status(409).json({ error: 'تعارض مفتاح طلب السحب أو اختلاف بياناته؛ راجع سجل المعاملات أو أنشئ طلبًا جديدًا.' });
    }
    console.error('Supabase withdrawal error:', error.message);
    return res.status(500).json({ error: 'حدث خطأ في معالجة طلب السحب' });
  }
}

async function getDepositConfig(req, res) {
  try {
    if (!dataAccess.isSupabaseRuntime() || !await dataAccess.isSharedTronDepositSchemaReady()) return res.status(503).json({ success: false, error: 'خدمة الإيداع غير جاهزة حاليًا.' });
    const address = tronDepositService.getSharedDepositAddress();
    if (!address) return res.status(503).json({ success: false, error: 'عنوان محفظة الإيداع غير مهيأ حاليًا.' });
    const qrCode = await QRCode.toDataURL(address, { errorCorrectionLevel: 'M', margin: 1, width: 280 });
    return res.json({ success: true, network: 'TRC20', asset: 'USDT', address, qrCode, verification: 'txid' });
  } catch (error) {
    console.error('TRON deposit configuration failed:', error.message);
    return res.status(503).json({ success: false, error: 'تعذر تجهيز عنوان الإيداع؛ حاول لاحقًا.' });
  }
}

module.exports = { deposit, withdraw, getMyHistory, getDepositConfig, calculateHybridWithdrawalFee, sameWithdrawalIntent, getMinimumWithdrawalAmount };
