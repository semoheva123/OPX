const realtimeService = require('../services/realtimeService');
const kycStorage = require('../services/kycStorage');
const dataAccess = require('../services/dataAccess');
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
    const { code, name, price, tasks, dailyProfit, monthlyProfit, yearlyProfit, badgeColor } = req.body;
    if (!code || !name || price === undefined || tasks === undefined || dailyProfit === undefined) return res.status(400).json({ error: 'يرجى إدخال جميع البيانات الأساسية للمستوى' });
    if (!/^[A-Z][A-Z0-9_-]{1,15}$/i.test(String(code).trim())) return res.status(400).json({ error: 'كود المستوى يجب أن يتكون من أحرف وأرقام فقط' });
    if (String(name).trim().length < 2 || String(name).trim().length > 100) return res.status(400).json({ error: 'اسم المستوى غير صالح' });
    if (![price, tasks, dailyProfit, monthlyProfit, yearlyProfit].every(value => value === undefined || Number.isFinite(Number(value)) && Number(value) >= 0) || Number(tasks) < 1) return res.status(400).json({ error: 'قيم المستوى غير صالحة' });
    const level = { code: code.trim().toUpperCase(), name, price: Number(price), tasks: Number(tasks), dailyProfit: Number(dailyProfit), monthlyProfit: monthlyProfit ? Number(monthlyProfit) : Number(dailyProfit) * 30, yearlyProfit: yearlyProfit ? Number(yearlyProfit) : Number(dailyProfit) * 365, badgeColor: ALLOWED_BADGE_COLORS.has(badgeColor) ? badgeColor : DEFAULT_BADGE_COLOR };
    const existingLevel = await dataAccess.vipLevel.findOne({ code: level.code });
    const updatedLevel = existingLevel
      ? await dataAccess.vipLevel.updateOne({ id: existingLevel.id }, level)
      : await dataAccess.vipLevel.create(level);
    await createAudit(req, 'update_vip_level', level.code, { newValue: { price: level.price, tasks: level.tasks, dailyProfit: level.dailyProfit } });
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
    const [totalUsers, pendingWithdrawals, pendingDeposits, activeUsers, deposits, withdrawals, rewards, riskSummaryInfo, financialSummaryInfo, kycSummaryInfo] = await Promise.all([
      User.countDocuments(),
      Transaction.countDocuments({ type: 'withdraw', status: 'pending' }),
      Transaction.countDocuments({ type: 'deposit', status: 'pending' }),
      User.countDocuments({ updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      dataAccess.transaction.find({ type: 'deposit', status: 'approved' }, { limit: 10000 }).then(rows => [{ total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) }]),
      dataAccess.transaction.find({ type: 'withdraw', status: 'approved' }, { limit: 10000 }).then(rows => [{ total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) }]),
      dataAccess.transaction.find({ type: { $in: ['reward', 'staking_reward', 'referral_commission'] }, status: 'approved' }, { limit: 10000 }).then(rows => [{ total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) }]),
      buildRiskSummary(30),
      buildFinancialSummary(30),
      buildKycSummary()
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
      financialSummary: financialSummaryInfo,
      kycSummary: kycSummaryInfo
    });
  } catch (err) { res.status(500).json({ success: false, error: 'حدث خطأ في معالجة الطلب' }); }
}

async function buildKycSummary() {
  const [total, pending, verified, rejected, notStarted] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ kycStatus: 'pending' }),
    User.countDocuments({ kycStatus: 'verified' }),
    User.countDocuments({ kycStatus: 'rejected' }),
    User.countDocuments({ kycStatus: 'not_started' })
  ]);

  return {
    total,
    pending,
    verified,
    rejected,
    notStarted,
    verificationRate: total ? Number(((verified / total) * 100).toFixed(2)) : 0,
    reviewQueue: pending + rejected
  };
}

async function kycSummary(req, res) {
  try {
    const summary = await buildKycSummary();
    res.json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ error: 'تعذر تحميل ملخص KYC' });
  }
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
  return res.status(503).json({ error: 'الفتح الاضطراري للخزنة غير متاح حتى تطبيق RPC الإدارة الذرية في Supabase' });
}

async function riskSummary(req, res) {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const summary = await buildRiskSummary(days);
    res.json({ success: true, summary });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل ملخص المخاطر' }); }
}

async function listUsers(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || '').trim().slice(0, 120);
    const filter = {};
    if (['user', 'admin', 'financial_admin', 'support_admin', 'monitor'].includes(req.query.role)) filter.role = req.query.role;
    if (req.query.tier) filter.tierCode = String(req.query.tier).trim().toUpperCase();
    if (req.query.status === 'banned') filter.isBanned = true;
    if (req.query.status === 'active') filter.isBanned = false;
    if (req.query.verified === 'yes') filter.emailVerified = true;
    if (req.query.verified === 'no') filter.emailVerified = false;
    if (['not_started', 'pending', 'verified', 'rejected'].includes(req.query.kycStatus)) filter.kycStatus = req.query.kycStatus;
    const allUsers = await dataAccess.user.find(filter, { sort: { createdAt: -1 }, limit: 10000 });
    const searchedUsers = search ? allUsers.filter(user => `${user.email || ''} ${user.referralCode || ''}`.toLowerCase().includes(search.toLowerCase())) : allUsers;
    const total = searchedUsers.length;
    const users = searchedUsers.slice((page - 1) * limit, page * limit);
    res.json({ success: true, users, page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function userDetails(req, res) {
  try {
    const user = await User.findById(req.params.userId).select('-password -resetOTP -twoFactorCode -twoFactorSecret -adminTwoFactorSecret');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const [transactions, auditLogs, sessions] = await Promise.all([
      Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      AuditLog.find({ entity: user._id.toString() }).populate('adminId', 'email').sort({ createdAt: -1 }).limit(50).lean(),
      Session.find({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).select('-jti').sort({ createdAt: -1 }).lean()
    ]);
    res.json({ success: true, user, transactions, auditLogs, sessions });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تفاصيل المستخدم' }); }
}

async function streamKycDocument(req, res) {
  try {
    const user = await User.findById(req.params.userId).select('kycDocumentUrl');
    const reference = String(user?.kycDocumentUrl || '');
    if (/^https:\/\/(?:i\.)?ibb\.co\//i.test(reference) || /^https:\/\/(?:www\.)?imgbb\.com\//i.test(reference)) return res.redirect(reference);
    if (!/^private:\/\//.test(reference)) return res.status(404).json({ error: 'وثيقة KYC غير موجودة أو قديمة' });
    await createAudit(req, 'view_kyc_document', user._id.toString(), { referenceType: 'private' });
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    if (!kycStorage.stream(reference, res)) return res.status(404).json({ error: 'ملف الوثيقة غير موجود' });
  } catch (error) {
    res.status(500).json({ error: 'تعذر عرض وثيقة KYC' });
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function complianceReport(req, res) {
  try {
    const filter = {};
    if (['not_started', 'pending', 'verified', 'rejected'].includes(req.query.kycStatus)) filter.kycStatus = req.query.kycStatus;
    const since = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
    const until = req.query.to ? new Date(`${req.query.to}T00:00:00.000Z`) : null;
    if (until && !Number.isNaN(until.valueOf())) until.setUTCDate(until.getUTCDate() + 1);
    if ((since && !Number.isNaN(since.valueOf())) || (until && !Number.isNaN(until.valueOf()))) {
      filter.updatedAt = {};
      if (since && !Number.isNaN(since.valueOf())) filter.updatedAt.$gte = since;
      if (until && !Number.isNaN(until.valueOf())) filter.updatedAt.$lt = until;
    }

    const users = await User.find(filter).select('email kycStatus kycCountry kycDocumentType kycSubmittedAt kycReviewedAt kycReviewedBy kycReason isBanned').populate('kycReviewedBy', 'email').sort({ updatedAt: -1 }).limit(10000).lean();
    const userIds = users.map(user => user._id);
    const riskTotals = userIds.length ? await Transaction.aggregate([
      { $match: { userId: { $in: userIds }, type: 'withdraw', riskScore: { $gt: 0 } } },
      { $group: { _id: '$userId', maxRiskScore: { $max: '$riskScore' }, highRiskCount: { $sum: { $cond: [{ $eq: ['$riskLevel', 'high'] }, 1, 0] } }, riskFlags: { $push: '$riskFlags' } } }
    ]) : [];
    const riskByUser = new Map(riskTotals.map(item => [String(item._id), item]));
    const rows = [
      ['البريد', 'حالة KYC', 'الدولة', 'نوع الوثيقة', 'تاريخ الإرسال', 'آخر مراجعة', 'راجع بواسطة', 'سبب الرفض', 'أعلى درجة خطر', 'سحوبات عالية الخطورة', 'محظور']
    ];
    for (const user of users) {
      const risk = riskByUser.get(String(user._id)) || {};
      rows.push([user.email, user.kycStatus || 'not_started', user.kycCountry, user.kycDocumentType, user.kycSubmittedAt?.toISOString?.() || '', user.kycReviewedAt?.toISOString?.() || '', user.kycReviewedBy?.email || '', user.kycReason, risk.maxRiskScore || 0, risk.highRiskCount || 0, user.isBanned ? 'نعم' : 'لا']);
    }
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="operix-compliance-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
    await createAudit(req, 'export_compliance_report', null, { count: users.length, kycStatus: req.query.kycStatus || 'all' });
    res.send(`\ufeff${csv}`);
  } catch (error) {
    res.status(500).json({ error: 'تعذر تصدير تقرير الامتثال' });
  }
}

async function reviewUserKyc(req, res) {
  try {
    const { status, notes } = req.body;
    const validStatuses = ['not_started', 'pending', 'verified', 'rejected'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'حالة KYC غير صالحة' });

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const previousStatus = user.kycStatus;
    user.kycStatus = status;
    user.kycReviewedAt = new Date();
    user.kycReviewedBy = req.user._id;
    user.kycNotes = String(notes || '').trim().slice(0, 500);
    if (status === 'rejected') user.kycReason = String(notes || '').trim().slice(0, 200) || 'الوثيقة غير مكتملة أو غير واضحة';
    else user.kycReason = '';
    if (status === 'pending' && !user.kycSubmittedAt) user.kycSubmittedAt = new Date();

    await user.save();
    await createAudit(req, 'review_user_kyc', user._id.toString(), { oldStatus: previousStatus, newStatus: status, notes: user.kycNotes });
    const notification = await Notification.create({
      userId: user._id,
      title: status === 'verified' ? 'تم اعتماد توثيق هويتك' : status === 'rejected' ? 'تحتاج وثائق KYC إلى تحديث' : 'تم تحديث حالة توثيق هويتك',
      body: status === 'verified' ? 'تمت الموافقة على مستندات التحقق الخاصة بك.' : status === 'rejected' ? (user.kycReason || 'يرجى مراجعة الملاحظات وإرسال وثائق واضحة مجدداً.') : 'تم تحديث حالة طلب التحقق الخاص بك.',
      type: 'system'
    });
    realtimeService.emit('notification_created', { notificationId: notification._id, title: notification.title, type: notification.type }, { userId: user._id });
    await emitUserDataChanged(user._id, 'kyc_reviewed');

    res.json({ success: true, message: status === 'verified' ? 'تم اعتماد KYC بنجاح' : status === 'rejected' ? 'تم رفض KYC بنجاح' : 'تم تحديث حالة KYC', user });
  } catch (error) {
    res.status(500).json({ error: 'تعذر مراجعة KYC' });
  }
}

async function bulkToggleBan(req, res) {
  try {
    const userIds = Array.isArray(req.body.userIds) ? req.body.userIds.map(String).slice(0, 100) : [];
    const isBanned = Boolean(req.body.isBanned);
    if (!userIds.length) return res.status(400).json({ error: 'لم يتم تحديد مستخدمين' });
    const protectedRoles = ['admin', 'financial_admin', 'support_admin', 'monitor'];
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
    const user = await User.findById(req.params.userId || req.body.userId).select('email');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const result = await Session.updateMany({ userId: user._id, scope: 'user', revokedAt: null }, { $set: { revokedAt: new Date() } });
    await createAudit(req, 'revoke_user_sessions', user._id.toString(), { modifiedCount: result.modifiedCount });
    res.json({ success: true, modifiedCount: result.modifiedCount, message: 'تم إنهاء جلسات المستخدم' });
  } catch (error) { res.status(500).json({ error: 'تعذر إنهاء جلسات المستخدم' }); }
}

async function verifyUserEmail(req, res) {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { $set: { emailVerified: true, emailVerificationToken: null, emailVerificationExpire: null } }, { new: true }).select('email emailVerified');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await createAudit(req, 'verify_user_email', user._id.toString());
    await emitUserDataChanged(user._id, 'email_verified');
    res.json({ success: true, message: 'تم توثيق البريد الإلكتروني', user });
  } catch (error) { res.status(500).json({ error: 'تعذر توثيق البريد الإلكتروني' }); }
}

async function disableUserTwoFactor(req, res) {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { $set: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorCode: null, twoFactorExpire: null } }, { new: true }).select('email twoFactorEnabled');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await createAudit(req, 'disable_user_2fa', user._id.toString());
    await emitUserDataChanged(user._id, 'two_factor_updated');
    res.json({ success: true, message: 'تم تعطيل المصادقة الثنائية للمستخدم', user });
  } catch (error) { res.status(500).json({ error: 'تعذر تعطيل المصادقة الثنائية' }); }
}

async function resetDailyTasks(req, res) {
  try { await User.updateMany({}, { $set: { todayCompletedTasks: 0 } }); await createAudit(req, 'reset_daily_tasks'); res.json({ success: true, message: 'تم إعادة تعيين المهام اليومية لجميع المستخدمين بنجاح' }); }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function toggleBan(req, res) {
  try {
    const { userId, isBanned } = req.body;
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
    return res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function updateUserTier(req, res) {
  try {
    const { userId, tierCode } = req.body;
    const normalizedTier = String(tierCode || '').trim().toUpperCase();
    const [user, validTier] = await Promise.all([
      dataAccess.user.findById(userId),
      dataAccess.vipLevel.findOne({ code: normalizedTier })
    ]);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (!validTier) return res.status(400).json({ error: 'المستوى المحدد غير موجود' });
    const oldTier = user.tierCode;
    await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { tierCode: normalizedTier } });
    await createAudit(req, 'update_user_tier', String(user.id || user._id), { oldValue: oldTier, newValue: normalizedTier });
    await emitUserDataChanged(user.id || user._id, 'tier_updated');
    res.json({ success: true, message: 'تم تحديث مستوى المستخدم' });
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
    if (String(userId) === String(req.user._id)) return res.status(400).json({ error: 'لا يمكنك تغيير دور حسابك بنفسك' });
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

async function listWithdrawals(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const financialTypes = ['withdraw', 'deposit', 'vault_lock', 'vault_release', 'vault_early_release', 'vault_penalty', 'token_burn'];
    const filter = { type: { $in: financialTypes } };
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.type && req.query.type !== 'all' && financialTypes.includes(req.query.type)) filter.type = req.query.type;
    if (req.query.network && ['TRC20', 'BEP20'].includes(req.query.network)) filter.network = req.query.network;
    if (req.query.search) {
      const search = String(req.query.search).trim().slice(0, 120);
      const users = await User.find({ email: { $regex: search, $options: 'i' } }).select('_id').lean();
      filter.$or = [{ txHash: { $regex: search, $options: 'i' } }, { walletAddress: { $regex: search, $options: 'i' } }, { userId: { $in: users.map(user => user._id) } }];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00.000Z`);
      if (req.query.to) { const end = new Date(`${req.query.to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); filter.createdAt.$lt = end; }
    }
    const allTransactions = await dataAccess.transaction.find(filter, { sort: { createdAt: -1 }, limit: 10000 });
    const total = allTransactions.length;
    const withdrawals = allTransactions.slice((page - 1) * limit, page * limit);
    res.json({ success: true, withdrawals, page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function transactionDetails(req, res) {
  try {
    const transaction = await Transaction.findById(req.params.transactionId).populate('userId', 'email tierCode wallet walletAddress').lean();
    if (!transaction) return res.status(404).json({ error: 'المعاملة غير موجودة' });
    const auditLogs = await AuditLog.find({ entity: transaction._id.toString() }).populate('adminId', 'email').sort({ createdAt: -1 }).limit(20).lean();
    res.json({ success: true, transaction, auditLogs });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تفاصيل المعاملة' }); }
}

async function exportTransactions(req, res) {
  try {
    const financialTypes = ['withdraw', 'deposit', 'vault_lock', 'vault_release', 'vault_early_release', 'vault_penalty', 'token_burn'];
    const filter = { type: { $in: financialTypes } };
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.type && req.query.type !== 'all' && financialTypes.includes(req.query.type)) filter.type = req.query.type;
    if (req.query.network && ['TRC20', 'BEP20'].includes(req.query.network)) filter.network = req.query.network;
    if (req.query.search) {
      const search = String(req.query.search).trim().slice(0, 120);
      const users = await User.find({ email: { $regex: search, $options: 'i' } }).select('_id').lean();
      filter.$or = [{ txHash: { $regex: search, $options: 'i' } }, { walletAddress: { $regex: search, $options: 'i' } }, { userId: { $in: users.map(user => user._id) } }];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00.000Z`);
      if (req.query.to) { const end = new Date(`${req.query.to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); filter.createdAt.$lt = end; }
    }
    const transactions = await Transaction.find(filter).populate('userId', 'email tierCode').sort({ createdAt: -1 }).limit(10000).lean();
    res.json({ success: true, transactions });
  } catch (error) { res.status(500).json({ error: 'تعذر تصدير المعاملات' }); }
}

async function listAuditLogs(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
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

async function listReferrals(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const allUsers = await dataAccess.user.find({}, { sort: { createdAt: -1 }, limit: 10000 });
    const search = String(req.query.search || '').trim().toLowerCase();
    const filtered = allUsers.filter(user => user.referredBy && (!search || String(user.email || '').toLowerCase().includes(search)));
    const total = filtered.length;
    const referrals = filtered.slice((page - 1) * limit, page * limit);
    res.json({ success: true, referrals, page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل الإحالات' }); }
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

function transactionErrorResponse(res, err) {
  if (err.message === 'ADMIN_FINANCE_RPC_REQUIRED') return res.status(503).json({ error: 'معالجة المعاملات الإدارية متوقفة حتى تطبيق RPC الإدارة الذرية في Supabase' });
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message === 'NOT_FOUND' ? 'المعاملة غير موجودة' : err.message === 'PROCESSED' ? 'تمت معالجة هذه المعاملة سابقاً' : 'الإجراء المطلوب غير صالح' });
  return res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
}

async function withdrawalAction(req, res) {
  try {
    await applyWithdrawalAction(req.body.transactionId, req.body.action, req);
    res.json({ success: true, message: `تمت عملية (${req.body.action === 'approve' ? 'الموافقة' : 'الرفض'}) بنجاح` });
  } catch (err) { transactionErrorResponse(res, err); }
}

async function bulkWithdrawalAction(req, res) {
  const transactionIds = Array.isArray(req.body.transactionIds) ? req.body.transactionIds.map(String).slice(0, 50) : [];
  const action = req.body.action;
  if (!transactionIds.length || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'حدد معاملات وإجراءً صالحًا' });
  const results = [];
  for (const transactionId of transactionIds) {
    try { await applyWithdrawalAction(transactionId, action, req); results.push({ transactionId, success: true }); }
    catch (error) { results.push({ transactionId, success: false, error: error.message }); }
  }
  res.json({ success: true, processed: results.filter(item => item.success).length, failed: results.filter(item => !item.success).length, results });
}

function gameSettings(req, res) { res.json({ success: true, settings: req.app.locals.gameSettings }); }
async function updateGameSettings(req, res) {
  try {
    const settings = req.app.locals.gameSettings;
    ['spinMin', 'spinMax', 'boxMin', 'boxMax', 'dailyGameRewardCap', 'referralsPerCycle'].forEach(key => { if (req.body[key] !== undefined) settings[key] = Number(req.body[key]); });
    if ([settings.spinMin, settings.spinMax, settings.boxMin, settings.boxMax, settings.dailyGameRewardCap].some(value => !Number.isFinite(value) || value < 0) || !Number.isInteger(settings.referralsPerCycle) || settings.referralsPerCycle < 1 || settings.spinMin > settings.spinMax || settings.boxMin > settings.boxMax || settings.dailyGameRewardCap < Math.max(settings.spinMax, settings.boxMax)) return res.status(400).json({ success: false, error: 'إعدادات المكافآت غير صالحة أو السقف اليومي أقل من أعلى مكافأة ممكنة' });
    const existing = await dataAccess.gameSetting.findOne({ key: 'default' });
    if (existing) await dataAccess.gameSetting.updateOne({ id: existing.id }, settings);
    else await dataAccess.gameSetting.create({ key: 'default', ...settings });
    await createAudit(req, 'update_game_settings', null, { newValue: { ...settings } });
    await emitPlatformDataChanged('game_settings_updated');
    res.json({ success: true, message: 'تم حفظ إعدادات الألعاب بنجاح', settings });
  } catch (err) { res.status(500).json({ success: false, error: 'حدث خطأ في معالجة الطلب' }); }
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
  try { const campaigns = await Broadcast.find().sort({ createdAt: -1 }).limit(50).lean(); const readCounts = await Notification.aggregate([{ $match: { broadcastId: { $in: campaigns.map(item => item._id) }, readAt: { $ne: null } } }, { $group: { _id: '$broadcastId', count: { $sum: 1 } } }]); const reads = Object.fromEntries(readCounts.map(item => [String(item._id), item.count])); res.json({ success: true, campaigns: campaigns.map(item => ({ ...item, readCount: reads[String(item._id)] || 0 })) }); }
  catch (err) { res.status(500).json({ error: 'تعذر تحميل حملات البث' }); }
}

async function processScheduledBroadcasts(webpush) {
  return [];
}

module.exports = { saveVipLevel, listVipLevels, deleteVipLevel, overview, analytics, financialSummary, investmentVaultSummary, getInvestmentVaultContracts, updateInvestmentVaultContracts, listInvestmentVaults, emergencyReleaseInvestmentVault, riskSummary, kycSummary, listUsers, userDetails, streamKycDocument, complianceReport, reviewUserKyc, resetDailyTasks, toggleBan, bulkToggleBan, revokeUserSessions, verifyUserEmail, disableUserTwoFactor, updateUser, updateUserAccount, updateUserRole, updateUserTier, listWithdrawals, transactionDetails, exportTransactions, listAuditLogs, listReferrals, referralTree, withdrawalAction, bulkWithdrawalAction, gameSettings, updateGameSettings, broadcast, listBroadcasts, processScheduledBroadcasts, sendAdminAuditBroadcast };
