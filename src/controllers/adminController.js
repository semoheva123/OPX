const { withdrawalCompletedTemplate, withdrawalRejectedTemplate } = require('../services/emailTemplates');
const realtimeService = require('../services/realtimeService');
const dataAccess = require('../services/dataAccess');
const withdrawalPayoutService = require('../services/withdrawalPayoutService');
const { checkFinancialReadiness } = require('../services/financialReadinessService');
const { buildFinancialAccountingSummary } = require('../services/financialAccountingService');
const adminEmailBroadcastService = require('../services/adminEmailBroadcastService');
const emailVerificationReminderService = require('../services/emailVerificationReminderService');
const User = adminRepository(dataAccess.user);
const Transaction = adminRepository(dataAccess.transaction);
const InvestmentVault = adminRepository(dataAccess.investmentVault);
const InvestmentVaultContract = adminRepository(dataAccess.investmentVaultContract);
const VipLevel = adminRepository(dataAccess.vipLevel);
const AuditLog = adminRepository(dataAccess.auditLog);
const SecurityEvent = adminRepository(dataAccess.securityEvent);
const Broadcast = adminRepository(dataAccess.broadcast);
const Notification = adminRepository(dataAccess.notification);
const Session = adminRepository(dataAccess.session);
const { supabaseAdmin } = require('../config/supabase');

const ADMIN_USER_DETAIL_FIELDS = new Set(['id', '_id', 'username', 'email', 'role', 'emailVerified', 'isBanned', 'tierCode', 'referralCode', 'referredBy', 'walletAddress', 'adminTwoFactorEnabled', 'assetWallet', 'createdAt', 'updatedAt', 'lastLoginAt', 'metadata', 'profileImage', 'coverImage', 'socialBio', 'wallet']);

function sanitizeAdminUserDetail(user) {
  return Object.fromEntries(Object.entries(user?.toObject?.() || user || {}).filter(([key]) => ADMIN_USER_DETAIL_FIELDS.has(key)));
}

function adminRepository(repo) {
  function queryObject(operation, query) {
    const options = {};
    const builder = {
      sort(value) { options.sort = value; return builder; },
      skip(value) { options.skip = Number(value) || 0; return builder; },
      limit(value) { options.limit = Number(value) || 0; return builder; },
      select(value) { options.select = value; return builder; },
      populate() { return builder; },
      lean() { return builder; },
      then(resolve, reject) { return operation(query, options).then(resolve, reject); },
      catch(reject) { return operation(query, options).catch(reject); }
    };
    return builder;
  }
  function queryBuilder(query, single, changes, remove) {
    return queryObject(async (filter, options) => {
      if (remove) return repo.deleteOne(filter);
      if (changes) {
        const current = await repo.findOne(filter);
        if (!current) return null;
        return repo.updateOne({ id: current.id }, changes);
      }
      const rows = await repo.find(filter, options);
      const decorated = rows.map(item => decorate(item));
      return single ? (decorated[0] || null) : decorated;
    }, query);
  }
  function decorate(document) {
    if (!document || typeof document !== 'object') return document;
    if (!document.toObject) document.toObject = () => ({ ...document });
    if (!document.save) document.save = async () => repo.updateOne({ id: document.id }, Object.fromEntries(Object.entries(document).filter(([key]) => !['id', '_id', 'toObject', 'save'].includes(key))));
    return document;
  }
  return {
    find(query = {}) { return queryBuilder(query, false); },
    findOne(query = {}) { return queryBuilder(query, true); },
    findById(id) { return queryBuilder({ id: String(id) }, true); },
    findOneAndUpdate(query, changes) { return queryBuilder(query, true, changes); },
    findOneAndDelete(query) { return queryBuilder(query, true, null, true); },
    findByIdAndUpdate(id, changes) { return queryBuilder({ id: String(id) }, true, changes); },
    findByIdAndDelete(id) { return queryBuilder({ id: String(id) }, true, null, true); },
    async create(data) { return repo.create(data); },
    async insertMany(rows) { return Promise.all(rows.map(row => repo.create(row))); },
    async updateOne(query, changes) { return repo.updateOne(query, changes); },
    async updateMany(query, changes) { return repo.updateMany(query, changes); },
    async countDocuments(query = {}) { return repo.countDocuments(query); },
    async aggregate() { return []; }
  };
}

const AdminUser = adminRepository(User);
const AdminTransaction = adminRepository(Transaction);
const AdminVipLevel = adminRepository(VipLevel);
const AdminInvestmentVault = adminRepository(InvestmentVault);
const AdminInvestmentVaultContract = adminRepository(InvestmentVaultContract);
const AdminAuditLog = adminRepository(AuditLog);
const AdminSecurityEvent = adminRepository(SecurityEvent);
const AdminNotification = adminRepository(Notification);
const AdminSession = adminRepository(Session);
const DEFAULT_VAULT_CONTRACTS = [90, 180, 365].map(durationDays => ({ durationDays, expectedReturnRate: 0, enabled: true, label: '' }));

const DEFAULT_BADGE_COLOR = 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400';
const ALLOWED_BADGE_COLORS = new Set([
  DEFAULT_BADGE_COLOR,
  'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400',
  'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400',
  'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400',
  'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400'
]);

async function createAudit(req, action, targetId, details = {}, session) {
  if (dataAccess.isSupabaseRuntime() && supabaseAdmin) {
    const payload = {
      actor_id: req?.user?.id || req?.user?._id || null,
      action,
      entity: String(targetId || ''),
      metadata: details && typeof details === 'object' ? details : {},
      created_at: new Date().toISOString()
    };
    const { error } = await supabaseAdmin.from('audit_logs').insert(payload);
    if (error) throw error;
    return payload;
  }

  const log = new AuditLog({ adminId: req.user.id, action, targetId, details, ip: req.ip, userAgent: req.get('user-agent') || 'unknown' });
  return session ? log.save({ session }) : log.save();
}

async function emitUserDataChanged(userId, reason) {
  await realtimeService.publish('user_data_changed', { reason, timestamp: new Date().toISOString() }, { userId });
}

async function emitPlatformDataChanged(reason) {
  const users = await User.find().select('_id').lean();
  for (const user of users) await emitUserDataChanged(user._id, reason);
}

async function saveVipLevel(req, res) {
  try {
    const { code, name, price, dailyProfit, monthlyProfit, yearlyProfit, badgeColor } = req.body;
    const evaluationCount = Number(req.body.evaluationCount ?? (Number(req.body.tasks) - 1));
    if (!code || !name || price === undefined || dailyProfit === undefined || !Number.isInteger(evaluationCount)) return res.status(400).json({ error: 'يرجى إدخال بيانات المستوى وعدد التقييمات اليومية' });
    if (!/^[A-Z][A-Z0-9_-]{1,15}$/i.test(String(code).trim())) return res.status(400).json({ error: 'كود المستوى يجب أن يتكون من أحرف وأرقام فقط' });
    if (String(name).trim().length < 2 || String(name).trim().length > 100) return res.status(400).json({ error: 'اسم المستوى غير صالح' });
    if (![price, dailyProfit, monthlyProfit, yearlyProfit].every(value => value === undefined || Number.isFinite(Number(value)) && Number(value) >= 0) || evaluationCount < 0 || evaluationCount > 49) return res.status(400).json({ error: 'قيم المستوى أو عدد التقييمات غير صالح (0 إلى 49)' });
    const level = { code: code.trim().toUpperCase(), name: name.trim(), price: Number(price), tasks: evaluationCount + 1, dailyTasks: [], dailyProfit: Number(dailyProfit), monthlyProfit: monthlyProfit ? Number(monthlyProfit) : Number(dailyProfit) * 30, yearlyProfit: yearlyProfit ? Number(yearlyProfit) : Number(dailyProfit) * 365, badgeColor: ALLOWED_BADGE_COLORS.has(badgeColor) ? badgeColor : DEFAULT_BADGE_COLOR };
    const existingLevel = await dataAccess.vipLevel.findOne({ code: level.code });
    const updatedLevel = existingLevel
      ? await dataAccess.vipLevel.updateOne({ id: existingLevel.id }, level)
      : await dataAccess.vipLevel.create(level);
    await createAudit(req, 'update_vip_level', level.code, { newValue: { price: level.price, tasks: level.tasks, evaluationTaskCount: evaluationCount, dailyProfit: level.dailyProfit } });
    await emitPlatformDataChanged('vip_level_updated');
    res.json({ success: true, message: 'تم حفظ المستوى بنجاح', level: updatedLevel });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function deleteVipLevel(req, res) {
  try {
    const code = req.params.code.toUpperCase();
    const assignedUsers = await User.countDocuments({ tierCode: code });
    if (assignedUsers > 0) return res.status(400).json({ error: `لا يمكن حذف المستوى لأنه مرتبط بـ ${assignedUsers} مستخدم. غيّر مستوياتهم أولًا.` });
    const deleted = await dataAccess.vipLevel.findOne({ code });
    if (!deleted) return res.status(404).json({ error: 'المستوى غير موجود' });
    await dataAccess.vipLevel.deleteOne({ id: deleted.id });
    await createAudit(req, 'delete_vip_level', deleted.code, { oldValue: deleted });
    await emitPlatformDataChanged('vip_level_deleted');
    res.json({ success: true, message: 'تم حذف المستوى بنجاح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function listVipLevels(req, res) {
  try {
    const levels = await dataAccess.vipLevel.find({}, { sort: { price: 1 }, limit: 100 });
    res.json({ success: true, levels });
  } catch (error) {
    res.status(500).json({ error: 'تعذر تحميل مستويات VIP' });
  }
}

async function overview(req, res) {
  try {
    const [totalUsers, pendingWithdrawals, pendingDeposits, activeUsers, deposits, withdrawals, rewards, riskSummaryInfo, financialSummaryInfo] = await Promise.all([
      User.countDocuments(),
      Transaction.countDocuments({ type: 'withdraw', status: 'pending' }),
      Transaction.countDocuments({ type: 'deposit', status: 'pending' }),
      User.countDocuments({ lastLoginAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      dataAccess.transaction.find({ type: 'deposit', status: 'approved' }, { limit: 10000 }).then(rows => [{ total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) }]),
      dataAccess.transaction.find({ type: 'withdraw', status: 'approved' }, { limit: 10000 }).then(rows => [{ total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) }]),
      dataAccess.transaction.find({ type: { $in: ['reward', 'staking_reward', 'referral_commission'] }, status: 'approved' }, { limit: 10000 }).then(rows => [{ total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) }]),
      buildRiskSummary(30),
      buildFinancialSummary(30)
    ]);
    res.json({
      success: true,
      stats: {
        totalUsers,
        totalDeposits: deposits[0]?.total || 0,
        totalWithdrawals: withdrawals[0]?.total || 0,
        totalRewards: rewards[0]?.total || 0,
        activeUsers,
        pendingWithdrawals,
        pendingDeposits,
        pendingRequests: pendingWithdrawals + pendingDeposits
      },
      riskSummary: riskSummaryInfo,
      financialSummary: financialSummaryInfo
    });
  } catch (err) { res.status(500).json({ success: false, error: 'حدث خطأ في معالجة الطلب' }); }
}

async function analytics(req, res) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [transactions, users] = await Promise.all([
      dataAccess.transaction.find({ createdAt: { $gte: since } }, { limit: 10000 }),
      dataAccess.user.find({}, { limit: 10000 })
    ]);
    const securityEvents = typeof dataAccess.securityEvent.find === 'function'
      ? await dataAccess.securityEvent.find({ createdAt: { $gte: since } }, { limit: 10000 }).catch(() => [])
      : [];
    const dailyMap = new Map();
    transactions.forEach(transaction => { const day = new Date(transaction.createdAt).toISOString().slice(0, 10); const key = `${day}:${transaction.type}`; const item = dailyMap.get(key) || { _id: { day, type: transaction.type }, total: 0, count: 0 }; item.total += Number(transaction.amount || 0); item.count += 1; dailyMap.set(key, item); });
    const roleMap = new Map();
    users.forEach(user => roleMap.set(user.role, (roleMap.get(user.role) || 0) + 1));
    const securityMap = new Map();
    securityEvents.forEach(event => securityMap.set(event.event, (securityMap.get(event.event) || 0) + 1));
    const daily = [...dailyMap.values()].sort((a, b) => a._id.day.localeCompare(b._id.day));
    const usersByRole = [...roleMap.entries()].map(([role, count]) => ({ _id: role, count }));
    const security = [...securityMap.entries()].map(([event, count]) => ({ _id: event, count }));
    res.json({ success: true, periodDays: 30, daily, usersByRole, security });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل التحليلات' }); }
}

async function buildFinancialSummary(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const transactions = await dataAccess.transaction.find({ createdAt: { $gte: since } }, { limit: 10000 });
  const approvedTransactions = transactions.filter(item => item.status === 'approved');
  const approvedSummary = approvedTransactions.reduce((summary, item) => { const amount = Number(item.amount || 0); if (item.type === 'deposit') summary.deposits += amount; if (item.type === 'withdraw') summary.withdrawals += amount; summary.net += item.type === 'deposit' ? amount : item.type === 'withdraw' ? -amount : 0; return summary; }, { deposits: 0, withdrawals: 0, net: 0 });
  const pendingTransactions = transactions.filter(item => item.status === 'pending');
  const rejectedTransactions = transactions.filter(item => item.status === 'rejected');
  const pendingSummary = { count: pendingTransactions.length, total: pendingTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
  const rejectedSummary = { count: rejectedTransactions.length, total: rejectedTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
  const byDayMap = new Map();
  transactions.forEach(item => { const date = new Date(item.createdAt).toISOString().slice(0, 10); const row = byDayMap.get(date) || { date, deposits: 0, withdrawals: 0, net: 0, count: 0 }; const amount = Number(item.amount || 0); if (item.type === 'deposit') { row.deposits += amount; row.net += amount; } if (item.type === 'withdraw') { row.withdrawals += amount; row.net -= amount; } row.count += 1; byDayMap.set(date, row); });

  return {
    periodDays: days,
    totalDeposits: Number(approvedSummary.deposits || 0),
    totalWithdrawals: Number(approvedSummary.withdrawals || 0),
    netRevenue: Number(approvedSummary.net || 0),
    pendingCount: Number(pendingSummary.count || 0),
    pendingAmount: Number(pendingSummary.total || 0),
    rejectedCount: Number(rejectedSummary.count || 0),
    rejectedAmount: Number(rejectedSummary.total || 0),
    byDay: [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  };
}

async function buildRiskSummary(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [failedLogins, newDevices, pendingTransactions, largeWithdrawals] = await Promise.all([
    SecurityEvent.countDocuments({ event: 'login_failed', createdAt: { $gte: since } }),
    SecurityEvent.countDocuments({ event: 'new_device', createdAt: { $gte: since } }),
    Transaction.countDocuments({ status: 'pending', createdAt: { $gte: since } }),
    Transaction.countDocuments({ type: 'withdraw', status: 'pending', amount: { $gte: 500 }, createdAt: { $gte: since } })
  ]);

  const riskScore = Math.min(100, Math.round((failedLogins * 2.5) + (newDevices * 3) + (pendingTransactions * 5) + (largeWithdrawals * 8)));
  let riskLevel = 'low';
  if (riskScore >= 70) riskLevel = 'high';
  else if (riskScore >= 40) riskLevel = 'medium';

  const focus = [];
  if (failedLogins > 5) focus.push('محاولات دخول فاشلة متكررة');
  if (pendingTransactions > 3) focus.push('طلبات معلقة تحتاج مراجعة');
  if (newDevices > 2) focus.push('أجهزة جديدة سجّلت مؤخراً');
  if (largeWithdrawals > 0) focus.push('سحوبات كبيرة تحتاج فحصًا دقيقًا');
  if (!focus.length) focus.push('لا توجد إشارات خطر فورية');

  return {
    periodDays: days,
    riskScore,
    riskLevel,
    failedLogins,
    newDevices,
    pendingTransactions,
    largeWithdrawals,
    focus
  };
}

async function financialSummary(req, res) {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const summary = await buildFinancialSummary(days);
    res.json({ success: true, summary });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل الملخص المالي' }); }
}

async function financialReadiness(req, res) {
  try {
    const readiness = await checkFinancialReadiness();
    const checks = readiness?.checks || {};
    res.json({
      success: true,
      readyForControlledTest: Boolean(readiness?.readyForControlledTest),
      ready: Boolean(readiness?.readyForControlledTest),
      switches: readiness?.switches || {},
      checks: {
        supabaseReachable: Boolean(checks.supabaseReachable),
        financialSchemaReady: Boolean(checks.financialSchemaReady),
        noUnresolvedPayouts: Boolean(checks.noUnresolvedPayouts),
        depositXpubDerivesAddress: Boolean(checks.depositXpubDerivesAddress),
        tronUsdtContractValid: Boolean(checks.tronUsdtContractValid),
        payoutKeyConfigured: Boolean(checks.payoutKeyConfigured),
        payoutKeyValid: Boolean(checks.payoutKeyValid),
        payoutKeyFailure: checks.payoutKeyFailure || null,
        tronProviderReachable: Boolean(checks.tronProviderReachable),
        payoutBalancesReadable: Boolean(checks.payoutBalancesReadable),
        payoutUsdtFunded: Boolean(checks.payoutUsdtFunded),
        payoutTrxSufficient: Boolean(checks.payoutTrxSufficient)
      },
      summary: {
        totalChecks: Object.keys(readiness?.checks || {}).length,
        passedChecks: Object.values(readiness?.checks || {}).filter(Boolean).length,
        failedChecks: Object.values(readiness?.checks || {}).filter(value => value === false).length,
        blockedReason: readiness?.readyForControlledTest ? 'all_clear' : 'read_only_preflight_blocked'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'تعذر تحميل جاهزية الماليات' });
  }
}

async function financialAccounting(req, res) {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const summary = await buildFinancialAccountingSummary(days, new Date());
    res.json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ success: false, error: 'تعذر تحميل ملخص المحاسبة' });
  }
}

async function investmentVaultSummary(req, res) {
  try {
    const now = new Date();
    const vaults = await dataAccess.investmentVault.find({}, { limit: 10000 });
    const summarize = items => ({ count: items.length, total: items.reduce((sum, item) => sum + Number(item.amount || 0), 0), users: new Set(items.map(item => String(item.userId))).size });
    const activeSummary = summarize(vaults.filter(item => item.status === 'active' && new Date(item.maturityDate) > now));
    const maturedSummary = summarize(vaults.filter(item => item.status === 'active' && new Date(item.maturityDate) <= now));
    const claimedSummary = summarize(vaults.filter(item => item.status === 'claimed'));
    res.json({ success: true, summary: { activeCount: activeSummary.count, activeAmount: activeSummary.total, activeUsers: activeSummary.users, maturedCount: maturedSummary.count, maturedAmount: maturedSummary.total, maturedUsers: maturedSummary.users, claimedCount: claimedSummary.count, claimedAmount: claimedSummary.total } });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل ملخص خزنة الاستثمار' }); }
}

async function getInvestmentVaultContracts(req, res) {
  try {
    const storedContracts = await dataAccess.investmentVaultContract.find({}, { sort: { durationDays: 1 } });
    const contracts = storedContracts.length ? storedContracts : DEFAULT_VAULT_CONTRACTS;
    res.json({ success: true, contracts });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل عقود الخزنة' }); }
}

async function updateInvestmentVaultContracts(req, res) {
  try {
    if (!Array.isArray(req.body.contracts) || !req.body.contracts.length) return res.status(400).json({ error: 'يجب إدخال عقد واحد على الأقل' });
    const contracts = req.body.contracts.map(contract => ({ durationDays: Number(contract.durationDays), expectedReturnRate: Number(contract.expectedReturnRate), enabled: contract.enabled !== false, label: String(contract.label || '').trim().slice(0, 120) }));
    if (contracts.some(contract => ![90, 180, 365].includes(contract.durationDays) || !Number.isFinite(contract.expectedReturnRate) || contract.expectedReturnRate < 0 || contract.expectedReturnRate > 100)) return res.status(400).json({ error: 'بيانات عقود الخزنة غير صالحة' });
    if (new Set(contracts.map(contract => contract.durationDays)).size !== contracts.length) return res.status(400).json({ error: 'لا يمكن تكرار مدة العقد' });
    const saved = [];
    for (const contract of contracts) {
      const existing = await dataAccess.investmentVaultContract.findOne({ durationDays: contract.durationDays });
      saved.push(existing ? await dataAccess.investmentVaultContract.updateOne({ id: existing.id }, contract) : await dataAccess.investmentVaultContract.create(contract));
    }
    await createAudit(req, 'update_investment_vault_contracts', null, { newValue: contracts });
    await emitPlatformDataChanged('vault_contracts_updated');
    res.json({ success: true, message: 'تم حفظ عقود الخزنة', contracts: saved });
  } catch (error) { res.status(500).json({ error: 'تعذر حفظ عقود الخزنة' }); }
}

async function listInvestmentVaults(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter = {};
    if (['active', 'claimed', 'emergency_released'].includes(req.query.status)) filter.status = req.query.status;
    const [allVaults, total] = await Promise.all([
      dataAccess.investmentVault.find(filter, { sort: { createdAt: -1 }, limit: 10000 }),
      dataAccess.investmentVault.countDocuments(filter)
    ]);
    const vaults = allVaults.slice((page - 1) * limit, page * limit);
    const now = Date.now();
    res.json({ success: true, vaults: vaults.map(vault => ({ ...vault, displayStatus: vault.status === 'active' && new Date(vault.maturityDate).getTime() <= now ? 'matured' : vault.status })), page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل قائمة خزائن الاستثمار' }); }
}

async function emergencyReleaseInvestmentVault(req, res) {
  try {
    if (!dataAccess.isSupabaseRuntime()) return res.status(503).json({ error: 'الفتح الاضطراري متاح فقط في وضع Supabase' });
    const ownerUserId = String(process.env.VAULT_OWNER_USER_ID || '').trim();
    if (!ownerUserId) return res.status(503).json({ error: 'لم يتم ضبط حساب مالك الخزنة في إعدادات الإنتاج' });
    const result = await dataAccess.callSupabaseRpc('operix_admin_emergency_vault_release_atomic', {
      p_vault_id: req.params.vaultId,
      p_admin_user_id: req.user?.id || req.user?._id || null,
      p_owner_user_id: ownerUserId,
      p_penalty_rate: 0.30
    });
    const vaultUserId = result?.vault?.userId || result?.vault?.user_id;
    await emitUserDataChanged(vaultUserId, 'vault_emergency_released');
    await emitUserDataChanged(ownerUserId, 'vault_penalty_received');
    return res.json({ success: true, message: 'تم تنفيذ الفتح الاضطراري وتسجيل توزيع 70/30', result });
  } catch (error) {
    const code = error.code || error.details?.code;
    if (error.message === 'VAULT_OWNER_NOT_CONFIGURED') return res.status(503).json({ error: 'لم يتم ضبط حساب مالك الخزنة في إعدادات الإنتاج' });
    if (error.message === 'VAULT_NOT_FOUND' || code === 'P0002') return res.status(404).json({ error: 'الخزنة غير موجودة' });
    if (error.message === 'VAULT_ALREADY_RELEASED') return res.status(409).json({ error: 'تمت معالجة هذه الخزنة سابقًا' });
    if (error.message === 'OWNER_WALLET_NOT_FOUND') return res.status(409).json({ error: 'محفظة مالك الخزنة غير موجودة' });
    console.error('Emergency vault release error:', error.message);
    return res.status(500).json({ error: 'تعذر تنفيذ الفتح الاضطراري للخزنة' });
  }
}

async function riskSummary(req, res) {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const summary = await buildRiskSummary(days);
    res.json({ success: true, summary });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل ملخص المخاطر' }); }
}

function buildAdminUserFilter(query = {}) {
  const filter = {};
  if (['user', 'admin', 'financial_admin', 'support_admin', 'monitor'].includes(query.role)) filter.role = query.role;
  if (query.tier) filter.tierCode = String(query.tier).trim().toUpperCase();
  if (query.status === 'banned') filter.isBanned = true;
  if (query.status === 'active') filter.isBanned = false;
  if (query.verified === 'yes') filter.emailVerified = true;
  if (query.verified === 'no') filter.emailVerified = false;
  return filter;
}

async function getAdminUserRows(query = {}) {
  const allUsers = await dataAccess.user.find(buildAdminUserFilter(query), { sort: { createdAt: -1 }, limit: 10000 });
  const search = String(query.search || '').trim().slice(0, 120).toLowerCase();
  return search ? allUsers.filter(user => `${user.username || ''} ${user.email || ''} ${user.referralCode || ''}`.toLowerCase().includes(search)) : allUsers;
}

async function listUsers(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const searchedUsers = await getAdminUserRows(req.query);
    const total = searchedUsers.length;
    const users = searchedUsers.slice((page - 1) * limit, page * limit);
    res.json({ success: true, users, page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function exportUsers(req, res) {
  try {
    const users = await getAdminUserRows(req.query);
    res.json({ success: true, users: users.map(user => ({
      username: user.username || '',
      email: user.email || '',
      role: user.role || 'user',
      tierCode: user.tierCode || 'A1',
      wallet: user.wallet || {},
      isBanned: Boolean(user.isBanned),
      emailVerified: Boolean(user.emailVerified),
      todayCompletedTasks: Number(user.todayCompletedTasks || 0),
      createdAt: user.createdAt || null
    })) });
  } catch (error) { res.status(500).json({ error: 'تعذر تصدير المستخدمين' }); }
}

async function userDetails(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) {
      const userRecord = await dataAccess.user.findById(req.params.userId);
      if (!userRecord) return res.status(404).json({ error: 'المستخدم غير موجود' });
      const user = sanitizeAdminUserDetail(userRecord);
      const userId = user.id || user._id;
      const [transactions, auditLogs, sessions] = await Promise.all([
        dataAccess.transaction.find({ userId }, { sort: { createdAt: -1 }, limit: 50 }).catch(() => []),
        dataAccess.auditLog.find({ entity: String(userId) }, { sort: { createdAt: -1 }, limit: 50 }).catch(() => []),
        dataAccess.session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } }, { sort: { createdAt: -1 }, limit: 50 }).catch(() => [])
      ]);
      return res.json({ success: true, user, transactions, auditLogs, sessions: sessions.map(session => { const safe = { ...session }; delete safe.jti; return safe; }) });
    }
    const user = await User.findById(req.params.userId).select('-password -resetOTP -twoFactorCode -twoFactorSecret -adminTwoFactorSecret');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const [transactions, auditLogs, sessions] = await Promise.all([
      Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      AuditLog.find({ entity: user._id.toString() }).populate('adminId', 'email').sort({ createdAt: -1 }).limit(50).lean(),
      Session.find({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).select('-jti').sort({ createdAt: -1 }).lean()
    ]);
    res.json({ success: true, user: sanitizeAdminUserDetail(user), transactions, auditLogs, sessions });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تفاصيل المستخدم' }); }
}

async function bulkToggleBan(req, res) {
  try {
    const userIds = Array.isArray(req.body.userIds) ? req.body.userIds.map(String).slice(0, 100) : [];
    const isBanned = Boolean(req.body.isBanned);
    if (!userIds.length) return res.status(400).json({ error: 'لم يتم تحديد مستخدمين' });
    const protectedRoles = ['admin', 'financial_admin', 'support_admin', 'monitor'];
    if (dataAccess.isSupabaseRuntime()) {
      const protectedUsers = await dataAccess.user.countDocuments({ id: { $in: userIds }, role: { $in: protectedRoles } });
      if (isBanned && protectedUsers > 0) return res.status(400).json({ error: 'لا يمكن حظر حسابات الإدارة أو المراقبة' });
      const result = await dataAccess.user.updateMany({ id: { $in: userIds }, role: { $nin: protectedRoles } }, { $set: { isBanned } });
      await createAudit(req, isBanned ? 'bulk_ban_users' : 'bulk_unban_users', null, { userIds, modifiedCount: result.modifiedCount });
      for (const userId of userIds) await emitUserDataChanged(userId, isBanned ? 'user_banned' : 'user_unbanned');
      return res.json({ success: true, modifiedCount: result.modifiedCount });
    }
    const protectedUsers = await User.countDocuments({ _id: { $in: userIds }, role: { $in: protectedRoles } });
    if (isBanned && protectedUsers > 0) return res.status(400).json({ error: 'لا يمكن حظر حسابات الإدارة أو المراقبة' });
    const result = await User.updateMany({ _id: { $in: userIds }, role: { $nin: protectedRoles } }, { $set: { isBanned } });
    await createAudit(req, isBanned ? 'bulk_ban_users' : 'bulk_unban_users', null, { userIds, modifiedCount: result.modifiedCount });
    for (const userId of userIds) {
      realtimeService.emit('account_status_changed', { isBanned, message: isBanned ? 'تم تعليق حسابك من قبل الإدارة' : 'تم إلغاء تعليق حسابك' }, { userId });
    }
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) { res.status(500).json({ error: 'تعذر تنفيذ الإجراء الجماعي' }); }
}

async function revokeUserSessions(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) {
      const user = await dataAccess.user.findById(req.params.userId || req.body.userId);
      if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
      const userId = user.id || user._id;
      const result = await dataAccess.session.updateMany({ userId, scope: 'user', revokedAt: null }, { $set: { revokedAt: new Date() } });
      await createAudit(req, 'revoke_user_sessions', String(userId), { modifiedCount: result.modifiedCount });
      return res.json({ success: true, modifiedCount: result.modifiedCount, message: 'تم إنهاء جلسات المستخدم' });
    }
    const user = await User.findById(req.params.userId || req.body.userId).select('email');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const result = await Session.updateMany({ userId: user._id, scope: 'user', revokedAt: null }, { $set: { revokedAt: new Date() } });
    await createAudit(req, 'revoke_user_sessions', user._id.toString(), { modifiedCount: result.modifiedCount });
    res.json({ success: true, modifiedCount: result.modifiedCount, message: 'تم إنهاء جلسات المستخدم' });
  } catch (error) { res.status(500).json({ error: 'تعذر إنهاء جلسات المستخدم' }); }
}

async function verifyUserEmail(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) {
      const user = await dataAccess.user.findById(req.params.userId);
      if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
      const userId = user.id || user._id;
      await dataAccess.user.updateOne({ id: userId }, { $set: { emailVerified: true, emailVerificationToken: null, emailVerificationExpire: null } });
      await createAudit(req, 'verify_user_email', String(userId));
      await emitUserDataChanged(userId, 'email_verified');
      return res.json({ success: true, message: 'تم توثيق البريد الإلكتروني', user: { id: userId, email: user.email, emailVerified: true } });
    }
    const user = await User.findByIdAndUpdate(req.params.userId, { $set: { emailVerified: true, emailVerificationToken: null, emailVerificationExpire: null } }, { new: true }).select('email emailVerified');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await createAudit(req, 'verify_user_email', user._id.toString());
    await emitUserDataChanged(user._id, 'email_verified');
    res.json({ success: true, message: 'تم توثيق البريد الإلكتروني', user });
  } catch (error) { res.status(500).json({ error: 'تعذر توثيق البريد الإلكتروني' }); }
}

async function disableUserTwoFactor(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) {
      const user = await dataAccess.user.findById(req.params.userId);
      if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
      const userId = user.id || user._id;
      await dataAccess.user.updateOne({ id: userId }, { $set: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorCode: null, twoFactorExpire: null } });
      await createAudit(req, 'disable_user_2fa', String(userId));
      await emitUserDataChanged(userId, 'two_factor_updated');
      return res.json({ success: true, message: 'تم تعطيل المصادقة الثنائية للمستخدم', user: { id: userId, email: user.email, twoFactorEnabled: false } });
    }
    const user = await User.findByIdAndUpdate(req.params.userId, { $set: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorCode: null, twoFactorExpire: null } }, { new: true }).select('email twoFactorEnabled');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await createAudit(req, 'disable_user_2fa', user._id.toString());
    await emitUserDataChanged(user._id, 'two_factor_updated');
    res.json({ success: true, message: 'تم تعطيل المصادقة الثنائية للمستخدم', user });
  } catch (error) { res.status(500).json({ error: 'تعذر تعطيل المصادقة الثنائية' }); }
}

async function resetDailyTasks(req, res) {
  try {
    const { userId, taskDate } = req.body || {};
    const targetDate = taskDate || new Date().toISOString().slice(0, 10);
    if (dataAccess.isSupabaseRuntime()) {
      const cleanupTarget = userId ? { userId, taskDate: targetDate } : { taskDate: targetDate };
      const resetQueries = [
        supabaseAdmin && supabaseAdmin.from('daily_task_completions').delete().eq('task_date', cleanupTarget.taskDate),
        supabaseAdmin && supabaseAdmin.from('daily_task_submissions').delete().eq('task_date', cleanupTarget.taskDate),
        supabaseAdmin && supabaseAdmin.from('daily_task_assignments').delete().eq('task_date', cleanupTarget.taskDate)
      ];
      if (cleanupTarget.userId) {
        resetQueries[0] = supabaseAdmin && supabaseAdmin.from('daily_task_completions').delete().eq('user_id', cleanupTarget.userId).eq('task_date', cleanupTarget.taskDate);
        resetQueries[1] = supabaseAdmin && supabaseAdmin.from('daily_task_submissions').delete().eq('user_id', cleanupTarget.userId).eq('task_date', cleanupTarget.taskDate);
        resetQueries[2] = supabaseAdmin && supabaseAdmin.from('daily_task_assignments').delete().eq('user_id', cleanupTarget.userId).eq('task_date', cleanupTarget.taskDate);
      }
      await Promise.all(resetQueries.filter(Boolean));
      await createAudit(req, 'reset_daily_tasks', userId || null, { targetDate, scope: userId ? 'user' : 'all' });
      return res.json({ success: true, message: userId ? 'تم إعادة تعيين المهام اليومية لهذا المستخدم بنجاح' : 'تم إعادة تعيين المهام اليومية لجميع المستخدمين في اليوم الحالي بنجاح' });
    }

    await User.updateMany({}, { $set: { todayCompletedTasks: 0 } });
    await createAudit(req, 'reset_daily_tasks');
    res.json({ success: true, message: 'تم إعادة تعيين المهام اليومية لجميع المستخدمين بنجاح' });
  } catch (err) {
    console.error('resetDailyTasks error:', err);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function toggleBan(req, res) {
  try {
    const { userId, isBanned } = req.body;
    if (dataAccess.isSupabaseRuntime()) {
      const existingUser = await dataAccess.user.findById(userId);
      if (!existingUser) return res.status(404).json({ error: 'المستخدم غير موجود' });
      if (isBanned && ['admin', 'financial_admin', 'support_admin', 'monitor'].includes(existingUser.role)) return res.status(400).json({ error: 'لا يمكن حظر حسابات الإدارة أو المراقبة' });
      await dataAccess.user.updateOne({ id: userId }, { $set: { isBanned: Boolean(isBanned) } });
      await createAudit(req, isBanned ? 'ban_user' : 'unban_user', String(userId), { newValue: Boolean(isBanned) });
      await emitUserDataChanged(userId, isBanned ? 'user_banned' : 'user_unbanned');
      return res.json({ success: true, message: isBanned ? 'تم حظر المستخدم بنجاح' : 'تم إلغاء حظر المستخدم بنجاح' });
    }
    const existingUser = await User.findById(userId).select('role');
    if (!existingUser) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (isBanned && ['admin', 'financial_admin', 'support_admin', 'monitor'].includes(existingUser.role)) return res.status(400).json({ error: 'لا يمكن حظر حسابات الإدارة أو المراقبة' });
    const user = await User.findByIdAndUpdate(userId, { isBanned: Boolean(isBanned) }, { new: true }).select('-password -resetOTP -twoFactorCode');
    await createAudit(req, isBanned ? 'ban_user' : 'unban_user', user._id.toString(), { newValue: isBanned });
    realtimeService.emit('user_status_changed', { userId: user._id, isBanned, message: isBanned ? 'تم حظر المستخدم' : 'تم إلغاء حظر المستخدم' }, { scope: 'admin' });
    realtimeService.emit('account_status_changed', { isBanned, message: isBanned ? 'تم تعليق حسابك من قبل الإدارة' : 'تم إلغاء تعليق حسابك' }, { userId: user._id });
    res.json({ success: true, message: isBanned ? 'تم حظر المستخدم بنجاح' : 'تم إلغاء حظر المستخدم بنجاح', user });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function updateUser(req, res) {
  try {
    const { userId, depositBalance, profitBalance, balance } = req.body;
    for (const value of [depositBalance, profitBalance, balance]) {
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) return res.status(400).json({ error: 'قيمة الرصيد غير صالحة' });
    }
    const result = await dataAccess.callSupabaseRpc('operix_admin_adjust_balance_atomic', {
      p_user_id: userId,
      p_deposit_balance: depositBalance === undefined ? null : Number(depositBalance),
      p_profit_balance: profitBalance === undefined ? null : Number(profitBalance),
      p_balance: balance === undefined ? null : Number(balance),
      p_admin_user_id: req.user?.id || null,
      p_reason: 'admin_adjustment'
    });
    await createAudit(req, 'update_user_balance', String(userId), { newValue: { balance: result?.wallet?.balance ?? null }, depositBalance, profitBalance });
    await emitUserDataChanged(userId, 'balance_updated');
    return res.json({ success: true, message: 'تم تعديل بيانات المستخدم بنجاح', user: result?.user || null, wallet: result?.wallet || null });
  } catch (err) {
    const errorCode = err.code || err.details?.code;
    if (err.message === 'USER_NOT_FOUND' || errorCode === 'P0002') return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (err.message === 'USER_WALLET_NOT_FOUND') return res.status(409).json({ error: 'محفظة المستخدم غير موجودة' });
    return res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function updateUserTier(req, res) {
  try {
    res.status(409).json({ error: 'لا يمكن تعديل مستوى المستخدم يدويًا؛ تتم ترقية المستوى عبر عملية تفعيل مدفوعة موثقة.' });
  } catch (err) { res.status(500).json({ error: 'تعذر تحديث مستوى المستخدم' }); }
}

async function updateUserAccount(req, res) {
  try {
    const { userId, password, walletAddress } = req.body;
    const user = await dataAccess.user.findById(userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const oldValue = { walletAddress: user.walletAddress, passwordChanged: false };
    const updatePayload = {};
    if (password !== undefined && password !== '') {
      if (String(password).length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
      updatePayload.password = await require('bcryptjs').hash(String(password), 12);
      oldValue.passwordChanged = true;
    }
    if (walletAddress !== undefined) updatePayload.walletAddress = String(walletAddress).trim();
    if (Object.keys(updatePayload).length) await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: updatePayload });
    await createAudit(req, 'update_user_account', String(user.id || user._id), { oldValue, newValue: { walletAddress: updatePayload.walletAddress ?? user.walletAddress, passwordChanged: oldValue.passwordChanged } });
    await emitUserDataChanged(user.id || user._id, 'account_updated');
    res.json({ success: true, message: 'تم تحديث بيانات الحساب بنجاح', user: { id: user.id || user._id, email: user.email, walletAddress: updatePayload.walletAddress ?? user.walletAddress } });
  } catch (err) { res.status(500).json({ error: 'تعذر تحديث بيانات الحساب' }); }
}

async function sendAdminAuditBroadcast(req, res) {
  try {
    await createAudit(req, 'broadcast_notification', null, { title: String(req.body.title || '').slice(0, 120) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'تعذر تسجيل الإشعار' }); }
}

async function updateUserRole(req, res) {
  try {
    const { userId, role } = req.body;
    const allowedRoles = ['user', 'admin', 'financial_admin', 'support_admin', 'monitor'];
    if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'الدور المحدد غير صالح' });
    if (String(userId) === String(req.user.id || req.user._id)) return res.status(400).json({ error: 'لا يمكنك تغيير دور حسابك بنفسك' });
    if (dataAccess.isSupabaseRuntime()) {
      const user = await dataAccess.user.findById(userId);
      if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
      if (user.role === 'admin' && role !== 'admin' && await dataAccess.user.countDocuments({ role: 'admin', isBanned: false }) <= 1) return res.status(400).json({ error: 'لا يمكن إزالة آخر مدير كامل' });
      const oldRole = user.role;
      await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { role } });
      await createAudit(req, 'update_user_role', String(user.id || user._id), { oldRole, newRole: role });
      await emitUserDataChanged(user.id || user._id, 'role_updated');
      return res.json({ success: true, message: 'تم تحديث صلاحيات المستخدم', role });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.role === 'admin' && role !== 'admin' && await User.countDocuments({ role: 'admin', isBanned: false }) <= 1) return res.status(400).json({ error: 'لا يمكن إزالة آخر مدير كامل' });
    const oldRole = user.role;
    user.role = role;
    await user.save();
    await createAudit(req, 'update_user_role', user._id.toString(), { oldRole, newRole: role });
    await emitUserDataChanged(user._id, 'role_updated');
    res.json({ success: true, message: 'تم تحديث صلاحيات المستخدم', role: user.role });
  } catch (err) { res.status(500).json({ error: 'تعذر تحديث صلاحيات المستخدم' }); }
}

async function findAdminFinancialTransactions(query = {}) {
  const financialTypes = ['withdraw', 'deposit', 'vault_lock', 'vault_release', 'vault_early_release', 'vault_penalty', 'token_burn'];
  const filter = { type: { $in: financialTypes } };
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.type && query.type !== 'all' && financialTypes.includes(query.type)) filter.type = query.type;
  if (query.network && ['TRC20', 'BEP20'].includes(query.network)) filter.network = query.network;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) { const end = new Date(`${query.to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); filter.createdAt.$lt = end; }
  }
  let transactions = await dataAccess.transaction.find(filter, { sort: { createdAt: -1 }, limit: 10000 });
  const search = String(query.search || '').trim().toLowerCase().slice(0, 120);
  if (search) {
    const users = await dataAccess.user.find({}, { limit: 10000 });
    const matchingUserIds = new Set(users.filter(user => `${user.username || ''} ${user.email || ''} ${user.referralCode || ''}`.toLowerCase().includes(search)).map(user => String(user.id || user._id)));
    transactions = transactions.filter(transaction => String(transaction.txHash || '').toLowerCase().includes(search) || String(transaction.walletAddress || '').toLowerCase().includes(search) || matchingUserIds.has(String(transaction.userId)));
  }
  const users = await dataAccess.user.find({}, { limit: 10000 });
  const usersById = new Map(users.map(user => [String(user.id || user._id), user]));
  return transactions.map(transaction => ({ ...transaction, userId: usersById.get(String(transaction.userId)) || transaction.userId }));
}

async function listWithdrawals(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const allTransactions = await findAdminFinancialTransactions(req.query);
    const total = allTransactions.length;
    const withdrawals = allTransactions.slice((page - 1) * limit, page * limit);
    const withdrawalIds = withdrawals.filter(item => item.type === 'withdraw').map(item => item.id || item._id);
    const payouts = withdrawalIds.length ? await dataAccess.withdrawalPayout.find({ transactionId: { $in: withdrawalIds } }, { limit: withdrawalIds.length }) : [];
    const payoutByTransaction = new Map(payouts.map(item => [String(item.transactionId), safePayout(item)]));
    withdrawals.forEach(item => { if (item.type === 'withdraw') item.payout = payoutByTransaction.get(String(item.id || item._id)) || null; });
    res.json({ success: true, withdrawals, page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function transactionDetails(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) {
      const transaction = await dataAccess.transaction.findOne({ id: req.params.transactionId });
      if (!transaction) return res.status(404).json({ error: 'المعاملة غير موجودة' });
      const user = transaction.userId ? await dataAccess.user.findById(transaction.userId) : null;
      const payout = transaction.type === 'withdraw' ? await dataAccess.withdrawalPayout.findOne({ transactionId: transaction.id || transaction._id }) : null;
      const auditLogs = await dataAccess.auditLog.find({ entity: String(transaction.id || transaction._id) }, { sort: { createdAt: -1 }, limit: 20 });
      return res.json({ success: true, transaction: { ...transaction, payout: safePayout(payout), userId: user ? { id: user.id || user._id, username: user.username, email: user.email, tierCode: user.tierCode, walletAddress: user.walletAddress } : transaction.userId }, auditLogs });
    }
    const transaction = await Transaction.findById(req.params.transactionId).populate('userId', 'username email tierCode wallet walletAddress').lean();
    if (!transaction) return res.status(404).json({ error: 'المعاملة غير موجودة' });
    const auditLogs = await AuditLog.find({ entity: transaction._id.toString() }).populate('adminId', 'email').sort({ createdAt: -1 }).limit(20).lean();
    res.json({ success: true, transaction, auditLogs });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تفاصيل المعاملة' }); }
}

async function exportTransactions(req, res) {
  try {
    const transactions = await findAdminFinancialTransactions(req.query);
    res.json({ success: true, transactions });
  } catch (error) { res.status(500).json({ error: 'تعذر تصدير المعاملات' }); }
}

async function listAuditLogs(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    if (dataAccess.isSupabaseRuntime()) {
      let logs = await dataAccess.auditLog.find({}, { sort: { createdAt: -1 }, limit: 10000 });
      if (req.query.action && req.query.action !== 'all') logs = logs.filter(log => log.action === String(req.query.action).slice(0, 80));
      const search = String(req.query.search || '').trim().toLowerCase().slice(0, 120);
      if (search) logs = logs.filter(log => String(log.action || '').toLowerCase().includes(search) || String(log.entity || '').toLowerCase().includes(search));
      if (req.query.date) logs = logs.filter(log => String(log.createdAt || '').slice(0, 10) === req.query.date);
      const total = logs.length;
      const pageLogs = logs.slice((page - 1) * limit, page * limit);
      const actorIds = [...new Set(pageLogs.map(log => log.actorId).filter(Boolean))];
      const actors = actorIds.length ? await dataAccess.user.find({ id: { $in: actorIds } }, { limit: actorIds.length }) : [];
      const actorMap = new Map(actors.map(actor => [String(actor.id || actor._id), actor]));
      return res.json({ success: true, logs: pageLogs.map(log => ({ ...log, adminId: actorMap.get(String(log.actorId)) ? { email: actorMap.get(String(log.actorId)).email } : null })), page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), total });
    }
    const filter = {};
    if (req.query.action && req.query.action !== 'all') filter.action = String(req.query.action).slice(0, 80);
    if (req.query.search) filter.$or = [{ action: { $regex: String(req.query.search).slice(0, 80), $options: 'i' } }, { entity: { $regex: String(req.query.search).slice(0, 120), $options: 'i' } }];
    if (req.query.date) { const start = new Date(`${req.query.date}T00:00:00.000Z`); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1); if (!Number.isNaN(start.valueOf())) filter.createdAt = { $gte: start, $lt: end }; }
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).populate('adminId', 'email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AuditLog.countDocuments(filter)
    ]);
    res.json({ success: true, logs, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل سجل التدقيق' }); }
}

async function getAdminReferralRows(query = {}) {
  const allUsers = await dataAccess.user.find({}, { sort: { createdAt: -1 }, limit: 10000 });
  const search = String(query.search || '').trim().toLowerCase().slice(0, 120);
  return allUsers.filter(user => user.referredBy && (!search || `${user.email || ''} ${user.username || ''} ${user.referralCode || ''} ${user.referredBy || ''}`.toLowerCase().includes(search)));
}

async function listReferrals(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filtered = await getAdminReferralRows(req.query);
    const total = filtered.length;
    const referrals = filtered.slice((page - 1) * limit, page * limit);
    res.json({ success: true, referrals, page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل الإحالات' }); }
}

async function exportReferrals(req, res) {
  try {
    const referrals = await getAdminReferralRows(req.query);
    res.json({ success: true, referrals: referrals.map(user => ({
      username: user.username || '',
      email: user.email || '',
      referralCode: user.referralCode || '',
      referredBy: user.referredBy || '',
      tierCode: user.tierCode || 'A1',
      isActive: Number(user.wallet?.totalDeposits || 0) > 0,
      totalDeposits: Number(user.wallet?.totalDeposits || 0),
      createdAt: user.createdAt || null
    })) });
  } catch (error) { res.status(500).json({ error: 'تعذر تصدير الإحالات' }); }
}

async function referralTree(req, res) {
  try {
    const root = await User.findById(req.params.userId).select('email referralCode referredBy tierCode isBanned createdAt');
    if (!root) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const users = await User.find({ referredBy: { $exists: true, $ne: null } }).select('email referralCode referredBy tierCode isBanned createdAt').lean();
    const childrenByReferrer = new Map();
    for (const user of users) {
      const children = childrenByReferrer.get(user.referredBy) || [];
      children.push(user);
      childrenByReferrer.set(user.referredBy, children);
    }
    const buildNode = (user, depth = 0) => ({
      id: user._id,
      email: user.email,
      referralCode: user.referralCode,
      tierCode: user.tierCode,
      isBanned: user.isBanned,
      totalDeposits: user.wallet?.totalDeposits || 0,
      createdAt: user.createdAt,
      children: depth < 20 ? (childrenByReferrer.get(user.referralCode) || []).map(child => buildNode(child, depth + 1)) : []
    });
    res.json({ success: true, tree: buildNode(root) });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل شجرة الإحالات' }); }
}

async function applyWithdrawalAction(transactionId, action, req) {
  if (dataAccess.isSupabaseRuntime()) {
    return await dataAccess.callSupabaseRpc('operix_admin_transaction_action_atomic', {
      p_transaction_id: transactionId,
      p_action: action,
      p_admin_user_id: req.user?.id || null,
      p_note: String(req.body?.note || '')
    });
  }
  throw Object.assign(new Error('ADMIN_FINANCE_RPC_REQUIRED'), { statusCode: 503 });
}

async function sendWithdrawalDecisionEmail(req, transaction, action) {
  const resend = req.app.locals.resend;
  const emailFrom = String(process.env.EMAIL_FROM || '').trim();
  if (!resend || !emailFrom || !transaction?.userId) return false;
  const user = await dataAccess.user.findById(transaction.userId);
  if (!user?.email) return false;
  const values = {
    amount: Number(action === 'approve' ? (transaction.netAmount || transaction.amount || 0) : (transaction.amount || 0)).toFixed(2),
    transactionId: transaction.id || transaction._id,
    walletAddress: transaction.walletAddress || '',
    ...(action === 'approve'
      ? { completedAt: new Date().toLocaleString('ar') }
      : { rejectedAt: new Date().toLocaleString('ar'), reason: String(req.body?.note || '').trim() })
  };
  const html = action === 'approve' ? withdrawalCompletedTemplate(values) : withdrawalRejectedTemplate(values);
  const result = await resend.emails.send({
    from: emailFrom,
    to: user.email,
    subject: action === 'approve' ? 'تمت الموافقة على طلب السحب - OPERIX' : 'تم رفض طلب السحب - OPERIX',
    html
  });
  if (result?.error) throw new Error(result.error.message || 'Email provider rejected the decision email');
  return true;
}

function transactionErrorResponse(res, err) {
  const errorCode = err.code || err.details?.code;
  if (err.message === 'ADMIN_FINANCE_RPC_REQUIRED') return res.status(503).json({ error: 'معالجة المعاملات الإدارية متوقفة حتى تطبيق RPC الإدارة الذرية في Supabase' });
  if (err.message === 'TRANSACTION_NOT_FOUND' || errorCode === 'P0002') return res.status(404).json({ error: 'المعاملة غير موجودة أو تمت إزالتها' });
  if (err.message === 'PROCESSED') return res.status(409).json({ error: 'تمت معالجة هذه المعاملة سابقًا' });
  if (['PAYOUT_MAY_HAVE_BEEN_SENT', 'PAYOUT_ALREADY_PREPARED', 'WITHDRAWAL_NOT_PENDING', 'PAYOUT_HASH_MISMATCH'].includes(err.message)) return res.status(409).json({ error: 'حالة التحويل تغيرت؛ لا يمكن إعادة الإرسال أو رد الرصيد قبل حسم حالة الشبكة' });
  if (err.message === 'FINANCE_PERMISSION_REQUIRED' || errorCode === '42501') return res.status(403).json({ error: 'ليس لديك صلاحية تنفيذ هذا الإجراء المالي' });
  if (err.message === 'INVALID_ACTION' || errorCode === 'P0001') return res.status(400).json({ error: 'الإجراء المطلوب غير صالح أو لا يمكن تنفيذه على هذه المعاملة' });
  if (err.message === 'USER_WALLET_NOT_FOUND') return res.status(409).json({ error: 'محفظة المستخدم غير موجودة ولا يمكن اعتماد المعاملة' });
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message === 'NOT_FOUND' ? 'المعاملة غير موجودة' : err.message === 'PROCESSED' ? 'تمت معالجة هذه المعاملة سابقاً' : 'الإجراء المطلوب غير صالح' });
  return res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
}

async function withdrawalAction(req, res) {
  try {
    const transactionId = String(req.body.transactionId || '').trim();
    const action = String(req.body.action || '').trim();
    const transaction = await dataAccess.transaction.findOne({ id: transactionId });
    if (!transaction) return res.status(404).json({ error: 'المعاملة غير موجودة' });
    let result;
    if (transaction.type === 'withdraw' && action === 'approve') {
      return await approveAndBroadcastWithdrawal(req, res, transactionId);
    }
    if (transaction.type === 'withdraw' && action === 'reject') {
      result = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_reject_atomic', {
        p_transaction_id: transactionId,
        p_admin_user_id: req.user?.id || null,
        p_note: String(req.body?.note || '')
      });
    } else {
      result = await applyWithdrawalAction(transactionId, action, req);
    }
    let emailSent = false;
    try { emailSent = await sendWithdrawalDecisionEmail(req, result.transaction, action); }
    catch (emailError) { console.error('Withdrawal decision email failed:', emailError.message); }
    res.json({ success: true, emailSent, message: `تمت عملية (${action === 'approve' ? 'الموافقة' : 'الرفض'}) بنجاح` });
  } catch (err) { transactionErrorResponse(res, err); }
}

async function approveAndBroadcastWithdrawal(req, res, transactionId) {
  if (String(process.env.WITHDRAWAL_PAYOUTS_ENABLED || '').toLowerCase() !== 'true') {
    return res.status(503).json({ success: false, error: 'الإرسال الآلي متوقف افتراضيًا. فعّله بعد تطبيق ترحيل قاعدة البيانات وتمويل محفظة الإرسال والتحقق منها.' });
  }
  const requestedTransaction = await dataAccess.transaction.findOne({ id: transactionId });
  if (!requestedTransaction || requestedTransaction.network !== 'TRC20') {
    return res.status(409).json({ success: false, error: 'تم إيقاف التحويلات المالية على الشبكات غير TRC20.' });
  }
  let payout;
  try {
    const claim = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_claim_atomic', {
      p_transaction_id: transactionId,
      p_admin_user_id: req.user?.id || null
    });
    payout = claim.payout;
    if (!payout) throw new Error('PAYOUT_CLAIM_FAILED');
    if (payout.status === 'paid') return res.json({ success: true, duplicate: true, payout: safePayout(payout), message: 'تم إرسال هذا السحب وتأكيده مسبقًا' });
    if (payout.status === 'broadcast') return res.status(202).json({ success: true, duplicate: true, payout: safePayout(payout), message: 'المعاملة قيد التأكيد؛ لن يتم إرسال تحويل مكرر' });
    if (payout.status === 'manual_review' || (payout.status === 'failed' && payout.txHash)) {
      return res.status(409).json({ error: 'تحتاج هذه الدفعة إلى مراجعة قبل أي إعادة إرسال', payout: safePayout(payout) });
    }

    let prepared;
    try {
      prepared = await withdrawalPayoutService.preparePayout(claim.transaction);
    } catch (error) {
      await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_failed_atomic', {
        p_transaction_id: transactionId, p_tx_hash: null, p_error: safePayoutError(error)
      });
      throw error;
    }

    payout = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_record_broadcast_atomic', {
      p_transaction_id: transactionId,
      p_admin_user_id: req.user?.id || null,
      p_tx_hash: prepared.txHash,
      p_sender_address: prepared.senderAddress,
      p_signed_payload: prepared.encryptedPayload,
      p_payload_expires_at: prepared.payloadExpiresAt
    });
    if (String(payout.txHash || '').toLowerCase() !== String(prepared.txHash).toLowerCase()) {
      return res.status(409).json({ error: 'تم حجز طلب السحب بواسطة عملية أخرى؛ لم يتم بث المعاملة التي أُنشئت الآن' });
    }

    try {
      await withdrawalPayoutService.broadcastPreparedPayout(payout.network, payout.signedPayload);
      payout = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_retry_atomic', { p_transaction_id: transactionId, p_error: '' });
    } catch (broadcastError) {
      // The signed transaction and its hash are durable before network broadcast. Cron can safely rebroadcast the exact same payload.
      payout = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_retry_atomic', { p_transaction_id: transactionId, p_error: safePayoutError(broadcastError) });
      console.error('Withdrawal broadcast deferred to retry worker:', safePayoutError(broadcastError));
    }
    return res.status(202).json({ success: true, payout: safePayout(payout), message: 'تم اعتماد الطلب وبث تحويل USDT؛ يجري التحقق من تأكيد الشبكة تلقائيًا' });
  } catch (error) {
    if (error.statusCode) return transactionErrorResponse(res, error);
    console.error('Withdrawal approval/payout failed:', safePayoutError(error));
    return res.status(503).json({ success: false, error: publicPayoutError(error) });
  }
}

function safePayout(payout) {
  if (!payout) return null;
  const { signedPayload, ...safe } = payout;
  return safe;
}

function safePayoutError(error) {
  return String(error?.message || 'PAYOUT_PROVIDER_ERROR').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

function publicPayoutError(error) {
  const message = safePayoutError(error);
  if (/NOT_CONFIGURED|not configured/i.test(message)) return 'الإرسال الآلي غير مهيأ: أضف مفاتيح المحفظة وعنوان RPC إلى إعدادات الخادم';
  if (/BALANCE_INSUFFICIENT/.test(message)) return 'رصيد محفظة الإرسال أو رصيد رسوم الشبكة غير كافٍ';
  if (/INVALID_.*RECIPIENT|INVALID_WITHDRAWAL_NETWORK|WITHDRAWAL_NETWORK_REQUIRED|PAYOUT_AMOUNT/.test(message)) return 'بيانات الشبكة أو عنوان الاستلام أو المبلغ غير صالح';
  return 'تعذر تجهيز التحويل. لم يتم إرسال الأموال، ويمكن إعادة المحاولة بعد معالجة إعداد المحفظة';
}

async function processAutomaticWithdrawalApprovals() {
  if (String(process.env.WITHDRAWAL_AUTO_APPROVAL_ENABLED || '').toLowerCase() !== 'true') {
    return { processed: 0, skipped: true, reason: 'WITHDRAWAL_AUTO_APPROVAL_DISABLED' };
  }
  if (String(process.env.WITHDRAWAL_PAYOUTS_ENABLED || '').toLowerCase() !== 'true') {
    return { processed: 0, skipped: true, reason: 'WITHDRAWAL_PAYOUTS_DISABLED' };
  }
  if (!dataAccess.isSupabaseRuntime()) return { processed: 0, skipped: true, reason: 'SUPABASE_RUNTIME_REQUIRED' };

  const automationAdminId = String(process.env.WITHDRAWAL_AUTO_APPROVAL_ADMIN_ID || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(automationAdminId)) {
    return { processed: 0, skipped: true, reason: 'WITHDRAWAL_AUTO_APPROVAL_ADMIN_ID_NOT_CONFIGURED' };
  }
  const readLimit = (name, fallback) => {
    const raw = String(process.env[name] || '').trim();
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const configuredMaxSingle = readLimit('WITHDRAWAL_AUTO_MAX_SINGLE_USDT', 100);
  const configuredMaxDaily = readLimit('WITHDRAWAL_AUTO_DAILY_LIMIT_USDT', 250);
  const configuredMaxRiskScore = readLimit('WITHDRAWAL_AUTO_MAX_RISK_SCORE', 20);
  const configuredDelayMinutes = readLimit('WITHDRAWAL_AUTO_DELAY_MINUTES', 30);
  if ([configuredMaxSingle, configuredMaxDaily, configuredMaxRiskScore, configuredDelayMinutes].some(value => value === null)) {
    return { processed: 0, skipped: true, reason: 'WITHDRAWAL_AUTO_APPROVAL_LIMIT_CONFIG_INVALID' };
  }
  const maxSingle = Math.min(5000, Math.max(20, configuredMaxSingle));
  const maxDaily = Math.max(0, Math.min(100000, configuredMaxDaily));
  const maxRiskScore = Math.min(39, Math.max(0, configuredMaxRiskScore));
  const delayMinutes = Math.min(10080, Math.max(10, configuredDelayMinutes));
  const eligibleBefore = new Date(Date.now() - delayMinutes * 60 * 1000);
  const pending = await dataAccess.transaction.find({
    type: 'withdraw', status: 'pending', network: 'TRC20', riskLevel: 'low',
    riskScore: { $lte: maxRiskScore }, amount: { $lte: maxSingle }, createdAt: { $lte: eligibleBefore }
  }, { sort: { createdAt: 1 }, limit: 5 });

  const results = [];
  for (const transaction of pending) {
    try {
      const user = await dataAccess.user.findById(transaction.userId);
      const amount = Number(transaction.amount || 0);
      if (!user || user.isBanned || !user.emailVerified ||
          String(user.walletNetwork || '').toUpperCase() !== 'TRC20' ||
          String(user.walletAddress || '').trim() !== String(transaction.walletAddress || '').trim() ||
          !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(transaction.walletAddress || '').trim())) {
        results.push({ transactionId: transaction.id, state: 'manual_review', reason: 'ACCOUNT_OR_DESTINATION_NOT_ELIGIBLE' });
        continue;
      }
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await dataAccess.transaction.find({ userId: transaction.userId, type: 'withdraw', status: { $in: ['pending', 'approved'] }, createdAt: { $gte: since } });
      const dailyTotal = recent.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (!Number.isFinite(amount) || amount <= 0 || dailyTotal > maxDaily) {
        results.push({ transactionId: transaction.id, state: 'manual_review', reason: 'AUTO_DAILY_LIMIT_EXCEEDED' });
        continue;
      }
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };
      await approveAndBroadcastWithdrawal({ user: { id: automationAdminId } }, response, transaction.id);
      results.push({ transactionId: transaction.id, state: response.statusCode < 400 ? 'dispatched' : 'deferred', statusCode: response.statusCode });
    } catch (error) {
      console.error(`Automatic withdrawal approval failed (${transaction.id}):`, safePayoutError(error));
      results.push({ transactionId: transaction.id, state: 'error' });
    }
  }
  return { processed: results.length, results };
}

async function processWithdrawalPayoutQueue(resendClient) {
  if (String(process.env.WITHDRAWAL_PAYOUTS_ENABLED || '').toLowerCase() !== 'true') return { processed: 0, skipped: true, reason: 'WITHDRAWAL_PAYOUTS_DISABLED' };
  if (!dataAccess.isSupabaseRuntime()) return { processed: 0, skipped: true };
  const stalePreparing = await dataAccess.withdrawalPayout.find({ status: 'preparing', txHash: null, updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }, { sort: { updatedAt: 1 }, limit: 2 });
  let recovered = 0;
  for (const payout of stalePreparing) {
    try {
      const result = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_recover_stale_preparing_atomic', { p_transaction_id: payout.transactionId });
      if (result) recovered++;
    } catch (error) {
      console.error(`Stale withdrawal preparation recovery failed (${payout.transactionId}):`, safePayoutError(error));
    }
  }
  const payouts = await dataAccess.withdrawalPayout.find({ status: 'broadcast', nextAttemptAt: { $lte: new Date() } }, { sort: { nextAttemptAt: 1 }, limit: 2 });
  const results = [];
  for (const payout of payouts) {
    try {
      if (payout.network !== 'TRC20') {
        await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_manual_review_atomic', {
          p_transaction_id: payout.transactionId, p_error: 'UNSUPPORTED_WITHDRAWAL_NETWORK_TRC20_ONLY'
        });
        results.push({ transactionId: payout.transactionId, state: 'manual_review' });
        continue;
      }
      const inspection = await withdrawalPayoutService.inspectPayout(payout.network, payout.txHash, payout.signedPayload);
      if (inspection.state === 'confirmed') {
        const result = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_paid_atomic', {
          p_transaction_id: payout.transactionId, p_tx_hash: payout.txHash, p_confirmations: inspection.confirmations || 0
        });
        if (!result.duplicate) {
          try { await realtimeService.publish('user_data_changed', { reason: 'withdrawal_paid', timestamp: new Date().toISOString() }, { userId: result.transaction.userId }); } catch (error) { }
          try { await realtimeService.publish('admin_transaction_updated', { transactionId: result.transaction.id, type: 'withdraw', status: 'approved' }, { scope: 'admin' }); } catch (error) { }
          try { await sendWithdrawalDecisionEmail({ app: { locals: { resend: resendClient } } }, result.transaction, 'approve'); }
          catch (error) { console.error('Confirmed payout email failed:', safePayoutError(error)); }
        }
        results.push({ transactionId: payout.transactionId, state: 'paid' });
        continue;
      }
      if (inspection.state === 'expired') {
        await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_manual_review_atomic', { p_transaction_id: payout.transactionId, p_error: 'SIGNED_TRANSACTION_EXPIRED_AND_NOT_FOUND_ON_EITHER_TRON_NODE' });
        results.push({ transactionId: payout.transactionId, state: 'manual_review' });
        continue;
      }
      if (inspection.state === 'failed') {
        await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_failed_atomic', {
          p_transaction_id: payout.transactionId, p_tx_hash: payout.txHash,
          p_error: inspection.state === 'expired' ? 'SIGNED_TRANSACTION_EXPIRED_NOT_CONFIRMED' : 'ON_CHAIN_TRANSACTION_REVERTED'
        });
        results.push({ transactionId: payout.transactionId, state: 'failed' });
        continue;
      }
      if (inspection.state === 'confirming' || inspection.state === 'confirming_failure') {
        await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_defer_atomic', { p_transaction_id: payout.transactionId });
        results.push({ transactionId: payout.transactionId, state: 'confirming' });
        continue;
      }
      if (Number(payout.broadcastAttempts || 0) >= withdrawalPayoutService.getMaxBroadcastAttempts()) {
        await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_manual_review_atomic', { p_transaction_id: payout.transactionId, p_error: 'MAX_SAME_HASH_BROADCAST_ATTEMPTS_REACHED' });
        results.push({ transactionId: payout.transactionId, state: 'manual_review' });
        continue;
      }
      try {
        await withdrawalPayoutService.broadcastPreparedPayout(payout.network, payout.signedPayload);
        await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_retry_atomic', { p_transaction_id: payout.transactionId, p_error: '' });
      } catch (error) {
        await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_retry_atomic', { p_transaction_id: payout.transactionId, p_error: safePayoutError(error) });
      }
      results.push({ transactionId: payout.transactionId, state: 'broadcast' });
    } catch (error) {
      console.error(`Withdrawal payout reconciliation failed (${payout.transactionId}):`, safePayoutError(error));
      try { await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_defer_atomic', { p_transaction_id: payout.transactionId }); }
      catch (deferError) { console.error(`Withdrawal payout reschedule failed (${payout.transactionId}):`, safePayoutError(deferError)); }
      results.push({ transactionId: payout.transactionId, state: 'error' });
    }
  }
  return { processed: results.length, recoveredStalePreparations: recovered, results };
}

async function reconcileWithdrawalPayout(req, res) {
  try {
    const transactionId = String(req.params.transactionId || '').trim();
    const payout = await dataAccess.withdrawalPayout.findOne({ transactionId });
    if (!payout || !payout.txHash) return res.status(404).json({ error: 'لا توجد دفعة موقعة لهذا الطلب' });
    if (!['broadcast', 'manual_review'].includes(payout.status)) return res.status(409).json({ error: 'حالة الدفعة لا تحتاج إلى فحص يدوي', payout: safePayout(payout) });
    const inspection = await withdrawalPayoutService.inspectPayout(payout.network, payout.txHash, payout.signedPayload);
    if (inspection.state === 'confirmed') {
      const result = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_paid_atomic', {
        p_transaction_id: transactionId, p_tx_hash: payout.txHash, p_confirmations: inspection.confirmations || 0
      });
      if (!result.duplicate) {
        try { await realtimeService.publish('user_data_changed', { reason: 'withdrawal_paid', timestamp: new Date().toISOString() }, { userId: result.transaction.userId }); } catch (error) { }
        try { await sendWithdrawalDecisionEmail({ app: { locals: { resend: req.app.locals.resend } } }, result.transaction, 'approve'); } catch (error) { console.error('Reconciled payout email failed:', safePayoutError(error)); }
      }
      return res.json({ success: true, payout: safePayout(result.payout), message: 'تم تأكيد التحويل على الشبكة وتحديث الطلب' });
    }
    if (inspection.state === 'failed' || inspection.state === 'expired') {
      const failed = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_failed_atomic', {
        p_transaction_id: transactionId, p_tx_hash: payout.txHash,
        p_error: inspection.state === 'expired' ? 'SIGNED_TRANSACTION_EXPIRED_AND_ABSENT' : 'ON_CHAIN_TRANSACTION_REVERTED_FINAL'
      });
      return res.json({ success: true, payout: safePayout(failed), message: 'أكدت الشبكة عدم نجاح التحويل؛ أصبح الطلب قابلًا للرفض وإعادة الرصيد' });
    }
    if (req.body?.rebroadcast === true && payout.status === 'manual_review' && inspection.state === 'pending') {
      const resumed = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_resume_atomic', {
        p_transaction_id: transactionId, p_admin_user_id: req.user?.id || null
      });
      try {
        await withdrawalPayoutService.broadcastPreparedPayout(resumed.network, resumed.signedPayload);
        const updated = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_retry_atomic', { p_transaction_id: transactionId, p_error: '' });
        return res.status(202).json({ success: true, payout: safePayout(updated), message: 'أُعيد بث نفس المعاملة والهاش، دون إنشاء تحويل جديد' });
      } catch (error) {
        const updated = await dataAccess.callSupabaseRpc('operix_admin_withdrawal_payout_retry_atomic', { p_transaction_id: transactionId, p_error: safePayoutError(error) });
        return res.status(202).json({ success: true, payout: safePayout(updated), message: 'بقيت المعاملة نفسها في قائمة إعادة المحاولة الآمنة' });
      }
    }
    return res.json({ success: true, state: inspection.state, canRebroadcastSameHash: payout.status === 'manual_review' && inspection.state === 'pending', payout: safePayout(payout), message: inspection.state === 'confirming' || inspection.state === 'confirming_failure' ? 'التحويل ظاهر على الشبكة وما زال ينتظر التأكيد النهائي' : 'لم يظهر تأكيد نهائي بعد؛ لم نغيّر حالة الطلب' });
  } catch (error) {
    console.error('Manual payout reconciliation failed:', safePayoutError(error));
    return transactionErrorResponse(res, error);
  }
}

async function bulkWithdrawalAction(req, res) {
  const transactionIds = Array.isArray(req.body.transactionIds) ? req.body.transactionIds.map(String).slice(0, 50) : [];
  const action = req.body.action;
  if (!transactionIds.length || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'حدد معاملات وإجراءً صالحًا' });
  const selected = await dataAccess.transaction.find({ id: { $in: transactionIds } }, { limit: transactionIds.length });
  if (action === 'approve' && selected.some(item => item.type === 'withdraw')) return res.status(400).json({ error: 'لأمان التحويلات، يجب اعتماد كل طلب سحب منفردًا من زر الموافقة الخاص به' });
  const results = [];
  for (const transactionId of transactionIds) {
    try {
      const transaction = selected.find(item => String(item.id || item._id) === transactionId);
      const result = transaction?.type === 'withdraw' && action === 'reject'
        ? await dataAccess.callSupabaseRpc('operix_admin_withdrawal_reject_atomic', { p_transaction_id: transactionId, p_admin_user_id: req.user?.id || null, p_note: String(req.body?.note || '') })
        : await applyWithdrawalAction(transactionId, action, req);
      let emailSent = false;
      try { emailSent = await sendWithdrawalDecisionEmail(req, result.transaction, action); }
      catch (emailError) { console.error('Withdrawal decision email failed:', emailError.message); }
      results.push({ transactionId, success: true, emailSent });
    }
    catch (error) { results.push({ transactionId, success: false, error: error.message }); }
  }
  res.json({ success: true, processed: results.filter(item => item.success).length, failed: results.filter(item => !item.success).length, results });
}

function gameSettings(req, res) { res.json({ success: true, settings: req.app.locals.gameSettings }); }
async function updateGameSettings(req, res) {
  try {
    const settings = { ...req.app.locals.gameSettings };
    ['spinMin', 'spinMax', 'boxMin', 'boxMax', 'dailyGameRewardCap', 'referralsPerCycle'].forEach(key => { if (req.body[key] !== undefined) settings[key] = Number(req.body[key]); });
    if ([settings.spinMin, settings.spinMax, settings.boxMin, settings.boxMax, settings.dailyGameRewardCap].some(value => !Number.isFinite(value) || value < 0) || !Number.isInteger(settings.referralsPerCycle) || settings.referralsPerCycle < 1 || settings.spinMin > settings.spinMax || settings.boxMin > settings.boxMax || settings.dailyGameRewardCap < Math.max(settings.spinMax, settings.boxMax)) return res.status(400).json({ success: false, error: 'إعدادات المكافآت غير صالحة أو السقف اليومي أقل من أعلى مكافأة ممكنة' });
    const existing = await dataAccess.gameSetting.findOne({ key: 'default' });
    if (existing) await dataAccess.gameSetting.updateOne({ id: existing.id }, settings);
    else await dataAccess.gameSetting.create({ key: 'default', ...settings });
    req.app.locals.gameSettings = settings;
    await createAudit(req, 'update_game_settings', null, { newValue: { ...settings } });
    await emitPlatformDataChanged('game_settings_updated');
    res.json({ success: true, message: 'تم حفظ إعدادات الألعاب بنجاح', settings });
  } catch (err) { res.status(500).json({ success: false, error: 'حدث خطأ في معالجة الطلب' }); }
}

function emailBroadcastValidationError(error) {
  const message = String(error?.message || '');
  if (message.startsWith('SUBJECT_LENGTH_INVALID')) return 'أدخل عنوانًا للبريد لا يتجاوز 150 حرفًا.';
  if (message.startsWith('BODY_LENGTH_INVALID')) return 'اكتب محتوى الرسالة بما لا يتجاوز 5000 حرف.';
  if (message === 'SUPABASE_RUNTIME_REQUIRED') return 'إرسال البريد الجماعي يتطلب قاعدة بيانات Supabase.';
  if (message.startsWith('RECIPIENT_LIMIT_EXCEEDED')) return 'عدد المستلمين يتجاوز الحد الآمن البالغ 10000. استخدم حملات أصغر حسب المستوى.';
  if (message === 'EMAIL_UNSUBSCRIBE_SECRET_NOT_CONFIGURED') return 'إعداد رابط إلغاء الاشتراك غير متاح على الخادم.';
  return null;
}

async function previewEmailBroadcast(req, res) {
  try {
    const { subject, body } = adminEmailBroadcastService.validateAnnouncement(req.body?.subject, req.body?.body);
    const recipients = await adminEmailBroadcastService.getEligibleRecipients();
    const emailFrom = String(process.env.EMAIL_FROM || '').trim();
    const deliveryReadiness = {
      providerConfigured: Boolean(req.app?.locals?.resend?.batch?.send),
      senderConfigured: Boolean(emailFrom && !/resend\.dev/i.test(emailFrom)),
      unsubscribeConfigured: Boolean(process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET)
    };
    deliveryReadiness.ready = Object.values(deliveryReadiness).every(Boolean);
    return res.json({ success: true, subject, body, recipientCount: recipients.length, recipientPolicy: 'verified_non_opted_out_users_and_official_admin', deliveryReadiness });
  } catch (error) {
    const validationMessage = emailBroadcastValidationError(error);
    if (validationMessage) return res.status(400).json({ success: false, error: validationMessage });
    console.error('Email broadcast preview failed:', error.message);
    return res.status(503).json({ success: false, error: 'تعذر تجهيز معاينة المستلمين. تحقق من قاعدة البيانات وحاول مجددًا.' });
  }
}

async function createEmailBroadcast(req, res) {
  try {
    const { subject, body } = adminEmailBroadcastService.validateAnnouncement(req.body?.subject, req.body?.body);
    if (req.body?.confirmed !== true || req.body?.confirmation !== 'إرسال التحديث') {
      return res.status(400).json({ success: false, error: 'اكتب عبارة «إرسال التحديث» وأكد إرسال الحملة.' });
    }
    const emailFrom = String(process.env.EMAIL_FROM || '').trim();
    if (!req.app.locals.resend?.batch?.send || !emailFrom || /resend\.dev/i.test(emailFrom)) {
      return res.status(503).json({ success: false, error: 'خدمة البريد غير مهيأة بعنوان مرسل موثق.' });
    }
    if (!process.env.EMAIL_UNSUBSCRIBE_SECRET && !process.env.JWT_SECRET) {
      return res.status(503).json({ success: false, error: 'إعداد توقيع إلغاء الاشتراك غير متاح.' });
    }

    const recipients = await adminEmailBroadcastService.getEligibleRecipients();
    if (!recipients.length) return res.status(409).json({ success: false, error: 'لا يوجد مستلمون مؤهلون: يلزم بريد موثق وعدم إلغاء الاشتراك.' });
    const created = await dataAccess.callSupabaseRpc('operix_create_email_broadcast_atomic', {
      p_subject: subject,
      p_body: body,
      p_created_by: req.user.id || req.user._id,
      p_recipients: recipients
    });
    const campaignId = String(created?.id || created?.campaignId || created?.campaign_id || '');
    if (!campaignId) throw new Error('EMAIL_BROADCAST_ID_MISSING');
    let delivery = null;
    try {
      delivery = await adminEmailBroadcastService.processAdminEmailBroadcastQueue(req.app.locals.resend, campaignId);
    } catch (deliveryError) {
      console.error(`Immediate email broadcast processing failed (${campaignId}):`, deliveryError.message);
    }
    const deliveryMessage = delivery?.sentCount > 0
      ? `بدأ تسليم ${delivery.sentCount} رسالة إلى مزود البريد${delivery.queuedCount ? `؛ بقي ${delivery.queuedCount} في الطابور` : ''}.`
      : delivery?.failedCount > 0
        ? `أُنشئت الحملة لكن تعذر تسليم ${delivery.failedCount} رسالة؛ راجع سجل الحملة قبل إعادة المحاولة.`
        : 'أُضيفت الحملة إلى الطابور؛ سيحاول العامل المجدول إرسال ما تبقى تلقائيًا.';
    return res.status(202).json({
      success: true,
      campaignId,
      recipientCount: recipients.length,
      auditRecorded: true,
      delivery,
      message: deliveryMessage
    });
  } catch (error) {
    const validationMessage = emailBroadcastValidationError(error);
    if (validationMessage) return res.status(400).json({ success: false, error: validationMessage });
    console.error('Email broadcast queue failed:', error.message);
    return res.status(503).json({ success: false, error: 'تعذر إنشاء حملة البريد. لم يبدأ الإرسال.' });
  }
}

async function listEmailBroadcasts(req, res) {
  try {
    const campaigns = await dataAccess.emailBroadcast.find({}, { sort: { createdAt: -1 }, limit: 50 });
    return res.json({ success: true, campaigns: campaigns.map(({ body, lastError, ...campaign }) => campaign) });
  } catch (error) {
    return res.status(503).json({ success: false, error: 'تعذر تحميل سجل حملات البريد.' });
  }
}

async function processAdminEmailBroadcasts(resend, campaignId) {
  return adminEmailBroadcastService.processAdminEmailBroadcastQueue(resend, campaignId);
}

async function previewEmailVerificationReminders(req, res) {
  try {
    const recipients = await emailVerificationReminderService.getEligibleRecipients();
    const emailFrom = String(process.env.EMAIL_FROM || '').trim();
    const deliveryReadiness = {
      providerConfigured: Boolean(req.app?.locals?.resend?.batch?.send),
      senderConfigured: Boolean(emailFrom && !/resend\.dev/i.test(emailFrom))
    };
    deliveryReadiness.ready = Object.values(deliveryReadiness).every(Boolean);
    return res.json({ success: true, recipientCount: recipients.length, deliveryReadiness, recipientPolicy: 'unverified_active_users_not_opted_out_cooldown_7d' });
  } catch (error) {
    if (error.message === 'SUPABASE_RUNTIME_REQUIRED') return res.status(400).json({ success: false, error: 'تذكير التوثيق يتطلب قاعدة بيانات Supabase.' });
    if (String(error.message || '').startsWith('RECIPIENT_LIMIT_EXCEEDED')) return res.status(400).json({ success: false, error: 'تجاوز عدد الحسابات حد الإرسال الآمن البالغ 10000.' });
    console.error('Email verification reminder preview failed:', error.message);
    return res.status(503).json({ success: false, error: 'تعذر احتساب الحسابات غير الموثقة حاليًا.' });
  }
}

async function createEmailVerificationReminders(req, res) {
  try {
    if (req.body?.confirmed !== true || req.body?.confirmation !== 'إرسال تذكيرات التوثيق') {
      return res.status(400).json({ success: false, error: 'اكتب عبارة «إرسال تذكيرات التوثيق» لتأكيد الجدولة.' });
    }
    const emailFrom = String(process.env.EMAIL_FROM || '').trim();
    if (!req.app?.locals?.resend?.batch?.send || !emailFrom || /resend\.dev/i.test(emailFrom)) {
      return res.status(503).json({ success: false, error: 'خدمة البريد غير مهيأة بعنوان مرسل موثق.' });
    }
    const recipients = await emailVerificationReminderService.getEligibleRecipients();
    if (!recipients.length) return res.status(409).json({ success: false, error: 'لا توجد حسابات مؤهلة لتذكير التوثيق حاليًا.' });
    const created = await dataAccess.callSupabaseRpc('operix_create_email_verification_reminder_atomic', {
      p_created_by: req.user.id || req.user._id,
      p_recipients: recipients
    });
    const campaignId = String(created?.id || created?.campaignId || created?.campaign_id || '');
    if (!campaignId) throw new Error('EMAIL_VERIFICATION_REMINDER_ID_MISSING');
    return res.status(202).json({ success: true, campaignId, recipientCount: recipients.length, message: 'تمت جدولة تذكيرات التوثيق على دفعات.' });
  } catch (error) {
    if (String(error.message || '').startsWith('RECIPIENT_LIMIT_EXCEEDED')) return res.status(400).json({ success: false, error: 'تجاوز عدد الحسابات حد الإرسال الآمن البالغ 10000.' });
    console.error('Email verification reminder queue failed:', error.message);
    return res.status(503).json({ success: false, error: 'تعذر جدولة تذكيرات التوثيق؛ لم يبدأ الإرسال.' });
  }
}

async function listEmailVerificationReminderCampaigns(req, res) {
  try {
    const campaigns = await dataAccess.emailVerificationReminderCampaign.find({}, { sort: { createdAt: -1 }, limit: 50 });
    return res.json({ success: true, campaigns });
  } catch (error) {
    return res.status(503).json({ success: false, error: 'تعذر تحميل سجل تذكيرات التوثيق.' });
  }
}

async function recoverRejectedEmailVerificationReminders(req, res) {
  if (req.body?.confirmed !== true || req.body?.confirmation !== 'استعادة العناوين المرفوضة') {
    return res.status(400).json({ success: false, error: 'اكتب عبارة «استعادة العناوين المرفوضة» لتأكيد الاستعادة.' });
  }
  try {
    const campaigns = await dataAccess.emailVerificationReminderCampaign.find(
      { status: 'partial', sentCount: 0 },
      { sort: { createdAt: -1 }, limit: 20 }
    );
    const rejectedCampaign = campaigns.find(campaign =>
      Number(campaign.sentCount || 0) === 0 && Number(campaign.failedCount || 0) > 0 &&
      /invalid\s+`?to`?\s+field/i.test(String(campaign.lastError || ''))
    );
    if (!rejectedCampaign) {
      return res.status(409).json({ success: false, error: 'لا توجد دفعة مرفوضة بالكامل يمكن استعادتها بأمان.' });
    }

    const campaignId = String(rejectedCampaign.id || rejectedCampaign._id);
    const recipients = await dataAccess.emailVerificationReminderRecipient.find(
      { campaignId, status: 'failed' },
      { limit: emailVerificationReminderService.MAX_RECIPIENTS }
    );
    let recoveredCount = 0;
    for (const recipient of recipients) {
      const userId = String(recipient.userId || recipient.user_id || '');
      const recipientEmail = String(recipient.email || '').trim().toLowerCase();
      if (!userId || !emailVerificationReminderService.isAllowedRecipientEmail(recipientEmail)) continue;
      const user = await dataAccess.user.findOne({ id: userId });
      if (!user || String(user.email || '').trim().toLowerCase() !== recipientEmail ||
          user.role !== 'user' || user.isBanned || user.emailVerified || user.emailUpdatesOptOut ||
          !user.emailVerificationReminderSentAt) continue;
      const updated = await dataAccess.user.updateOne(
        { id: userId, email: recipientEmail, emailVerificationReminderSentAt: user.emailVerificationReminderSentAt },
        { $set: { emailVerificationReminderSentAt: null } }
      );
      if (updated?.id) recoveredCount++;
    }
    let auditRecorded = false;
    if (supabaseAdmin) {
      try {
        await createAudit(req, 'recover_rejected_email_verification_reminders', campaignId, { recoveredCount });
        auditRecorded = true;
      } catch (auditError) {
        console.error('Email verification reminder recovery audit failed:', auditError.message);
      }
    }
    return res.json({
      success: true,
      recoveredCount,
      auditRecorded,
      message: recoveredCount
        ? `أُعيدت أهلية ${recoveredCount} عناوين مسموحة فقط؛ لم يُرسل أي بريد بهذا الإجراء.`
        : 'لم توجد عناوين مسموحة ما زالت مؤهلة للاستعادة؛ لم يُرسل أي بريد.'
    });
  } catch (error) {
    console.error('Email verification reminder recovery failed:', error.message);
    return res.status(503).json({ success: false, error: 'تعذرت استعادة أهلية العناوين المرفوضة.' });
  }
}

async function processEmailVerificationReminders(resend) {
  return emailVerificationReminderService.processQueue(resend);
}

async function broadcast(req, res) {
  try {
    const { title, body, audienceType = 'all', audienceValue = '', scheduledAt } = req.body;
    if (!title || !body || !['all', 'active', 'tier', 'role'].includes(audienceType)) return res.status(400).json({ error: 'بيانات البث غير صالحة' });
    const runAt = scheduledAt ? new Date(scheduledAt) : new Date();
    if (Number.isNaN(runAt.valueOf()) || runAt < new Date(Date.now() - 60000)) return res.status(400).json({ error: 'وقت الجدولة غير صالح' });
    const campaign = await Broadcast.create({ title: String(title).trim(), body: String(body).trim(), audienceType, audienceValue: String(audienceValue).trim(), scheduledAt: runAt, status: 'scheduled', createdBy: req.user._id });
    await createAudit(req, 'schedule_broadcast', campaign._id.toString(), { audienceType, audienceValue, scheduledAt: runAt });
    if (runAt > new Date()) return res.json({ success: true, scheduled: true, campaign, message: 'تمت جدولة البث بنجاح' });
    const result = await deliverBroadcast(campaign, req.app.locals.webpush);
    res.json({ success: true, campaign: result, message: `تم إرسال البث داخليًا إلى ${result.recipientCount} مستخدم` });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

function audienceFilter(campaign) {
  if (campaign.audienceType === 'active') return { updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } };
  if (campaign.audienceType === 'tier') return { tierCode: campaign.audienceValue.toUpperCase() };
  if (campaign.audienceType === 'role') return { role: campaign.audienceValue };
  return {};
}

async function deliverBroadcast(campaign, webpush) {
  const claimed = await Broadcast.findOneAndUpdate({ _id: campaign._id, status: 'scheduled' }, { status: 'sending' }, { new: true });
  if (!claimed) return Broadcast.findById(campaign._id);
  campaign = claimed;
  const users = await User.find(audienceFilter(campaign)).select('_id pushSubscription');
  const notifications = users.map(user => ({ userId: user._id, broadcastId: campaign._id, title: campaign.title, body: campaign.body, type: 'system' }));
  if (notifications.length) {
    await Notification.insertMany(notifications, { ordered: false });
    for (const user of users) realtimeService.emit('notification_created', { broadcastId: campaign._id, title: campaign.title }, { userId: user._id });
  }
  let pushSent = 0; let pushFailed = 0;
  if (webpush) for (const user of users.filter(item => item.pushSubscription)) {
    try { await webpush.sendNotification(user.pushSubscription, JSON.stringify({ title: campaign.title, body: campaign.body })); pushSent++; }
    catch (error) { pushFailed++; if ([404, 410].includes(error.statusCode)) await User.updateOne({ _id: user._id }, { $set: { pushSubscription: null } }); }
  }
  return Broadcast.findByIdAndUpdate(campaign._id, { status: 'sent', recipientCount: users.length, internalSent: users.length, pushSent, pushFailed, sentAt: new Date() }, { new: true });
}

async function listBroadcasts(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) {
      const campaigns = await dataAccess.broadcast.find({}, { sort: { createdAt: -1 }, limit: 50 });
      const ids = campaigns.map(item => item.id || item._id).filter(Boolean);
      const notifications = ids.length ? await dataAccess.notification.find({ broadcastId: { $in: ids }, readAt: { $ne: null } }, { limit: 10000 }) : [];
      const reads = notifications.reduce((counts, notification) => { const key = String(notification.broadcastId); counts[key] = (counts[key] || 0) + 1; return counts; }, {});
      return res.json({ success: true, campaigns: campaigns.map(item => ({ ...item, readCount: reads[String(item.id || item._id)] || 0 })) });
    }
    const campaigns = await Broadcast.find().sort({ createdAt: -1 }).limit(50).lean(); const readCounts = await Notification.aggregate([{ $match: { broadcastId: { $in: campaigns.map(item => item._id) }, readAt: { $ne: null } } }, { $group: { _id: '$broadcastId', count: { $sum: 1 } } }]); const reads = Object.fromEntries(readCounts.map(item => [String(item._id), item.count])); res.json({ success: true, campaigns: campaigns.map(item => ({ ...item, readCount: reads[String(item._id)] || 0 })) });
  }
  catch (err) { res.status(500).json({ error: 'تعذر تحميل حملات البث' }); }
}

async function processScheduledBroadcasts(webpush) {
  return [];
}

module.exports = { saveVipLevel, listVipLevels, deleteVipLevel, overview, analytics, financialSummary, financialReadiness, financialAccounting, investmentVaultSummary, getInvestmentVaultContracts, updateInvestmentVaultContracts, listInvestmentVaults, emergencyReleaseInvestmentVault, riskSummary, listUsers, exportUsers, userDetails, resetDailyTasks, toggleBan, bulkToggleBan, revokeUserSessions, verifyUserEmail, disableUserTwoFactor, updateUser, updateUserAccount, updateUserRole, updateUserTier, listWithdrawals, transactionDetails, exportTransactions, listAuditLogs, listReferrals, exportReferrals, referralTree, withdrawalAction, reconcileWithdrawalPayout, bulkWithdrawalAction, gameSettings, updateGameSettings, previewEmailBroadcast, createEmailBroadcast, listEmailBroadcasts, processAdminEmailBroadcasts, previewEmailVerificationReminders, createEmailVerificationReminders, listEmailVerificationReminderCampaigns, recoverRejectedEmailVerificationReminders, processEmailVerificationReminders, broadcast, listBroadcasts, processScheduledBroadcasts, processAutomaticWithdrawalApprovals, processWithdrawalPayoutQueue, sendAdminAuditBroadcast };
