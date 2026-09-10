const mongoose = require('mongoose');
const User = require('../models/User');
const InvestmentVault = require('../models/InvestmentVault');
const Transaction = require('../models/Transaction');
const realtimeService = require('../services/realtimeService');
const InvestmentVaultContract = require('../models/InvestmentVaultContract');
const dataAccess = require('../services/dataAccess');

const MIN_VAULT_AMOUNT = 10;
const DEFAULT_CONTRACTS = [90, 180, 365].map(durationDays => ({ durationDays, expectedReturnRate: 0, enabled: true, label: '' }));

async function getVaultContracts(req, res) {
  try {
    const storedContracts = dataAccess.isSupabaseRuntime()
      ? await dataAccess.investmentVaultContract.find({ enabled: true }, { sort: { durationDays: 1 } })
      : await InvestmentVaultContract.find({ enabled: true }).sort({ durationDays: 1 }).lean();
    const contracts = storedContracts.length ? storedContracts : DEFAULT_CONTRACTS;
    res.json({ success: true, contracts });
  } catch (error) {
    if (dataAccess.isSupabaseRuntime()) return res.json({ success: true, contracts: DEFAULT_CONTRACTS, storageUnavailable: true });
    res.status(500).json({ error: 'تعذر تحميل عقود الخزنة' });
  }
}

async function createVault(req, res) {
  if (dataAccess.isSupabaseRuntime()) return createVaultSupabase(req, res);
  const session = await mongoose.startSession();
  try {
    const amount = Number(req.body.amount);
    const durationDays = Number(req.body.durationDays);
    if (!Number.isFinite(amount) || amount < MIN_VAULT_AMOUNT) return res.status(400).json({ error: `الحد الأدنى لقفل السيولة هو ${MIN_VAULT_AMOUNT} USDT` });
    const storedContract = await InvestmentVaultContract.findOne({ durationDays }).lean();
    const contract = storedContract ? (storedContract.enabled ? storedContract : null) : DEFAULT_CONTRACTS.find(item => item.durationDays === durationDays);
    if (!contract) return res.status(400).json({ error: 'عقد الخزنة المحدد غير متاح حاليًا' });

    let vault;
    let user;
    await session.withTransaction(async () => {
      user = await User.findById(req.user.id).session(session);
      if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
      if (Number(user.USDT_balance || 0) < amount || Number(user.wallet.profitBalance || 0) < amount) throw Object.assign(new Error(`INSUFFICIENT_USDT:${Math.min(Number(user.USDT_balance || 0), Number(user.wallet.profitBalance || 0))}`), { statusCode: 400 });

      user.USDT_balance = Number((Number(user.USDT_balance) - amount).toFixed(4));
      user.wallet.profitBalance = Number((Number(user.wallet.profitBalance) - amount).toFixed(4));
      user.wallet.balance = Number((Number(user.wallet.depositBalance || 0) + user.wallet.profitBalance).toFixed(2));
      await user.save({ session });
      const expectedProfit = Number((amount * Number(contract.expectedReturnRate || 0) / 100).toFixed(4));
      vault = await new InvestmentVault({ userId: user._id, amount: Number(amount.toFixed(4)), durationDays, expectedReturnRate: contract.expectedReturnRate, expectedProfit, maturityDate: new Date(Date.now() + durationDays * 86400000), incentiveStatus: 'pending' }).save({ session });
      await new Transaction({ userId: user._id, type: 'vault_lock', amount, grossAmount: amount, usdtAmount: amount, walletAddress: `Investment Vault lock ${vault._id}`, status: 'approved' }).save({ session });
    });

    await realtimeService.publish('user_data_changed', { reason: 'vault_created', timestamp: new Date().toISOString() }, { userId: user._id });
    await realtimeService.publish('admin_transaction_created', { type: 'vault_lock', userId: user._id, vaultId: vault._id }, { scope: 'admin' });
    res.status(201).json({ success: true, message: 'تم تجميد USDT داخل خزنة الاستثمار بنجاح. الحافز المستقبلي غير مضمون ويخضع لسياسة المنصة.', vault, wallet: user.wallet, USDT_balance: user.USDT_balance });
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (error.message?.startsWith('INSUFFICIENT_USDT:')) return res.status(400).json({ error: `رصيد USDT القابل للتجميد غير كافٍ. المتاح: ${error.message.split(':')[1]} USDT` });
    console.error('Error creating investment vault:', error);
    res.status(500).json({ error: 'تعذر إنشاء خزنة الاستثمار' });
  } finally { await session.endSession(); }
}

async function createVaultSupabase(req, res) {
  try {
    const amount = Number(req.body.amount);
    const durationDays = Number(req.body.durationDays);
    if (!Number.isFinite(amount) || amount < MIN_VAULT_AMOUNT) return res.status(400).json({ error: `الحد الأدنى لقفل السيولة هو ${MIN_VAULT_AMOUNT} USDT` });
    const storedContract = await dataAccess.investmentVaultContract.findOne({ durationDays });
    const contract = storedContract ? (storedContract.enabled ? storedContract : null) : DEFAULT_CONTRACTS.find(item => item.durationDays === durationDays);
    if (!contract) return res.status(400).json({ error: 'عقد الخزنة المحدد غير متاح حاليًا' });
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (Number(user.USDT_balance || 0) < amount || Number(user.wallet?.profitBalance || 0) < amount) return res.status(400).json({ error: `رصيد USDT القابل للتجميد غير كافٍ. المتاح: ${Math.min(Number(user.USDT_balance || 0), Number(user.wallet?.profitBalance || 0))} USDT` });
    user.USDT_balance = Number((Number(user.USDT_balance) - amount).toFixed(4));
    user.wallet.profitBalance = Number((Number(user.wallet.profitBalance) - amount).toFixed(4));
    user.wallet.balance = Number((Number(user.wallet.depositBalance || 0) + user.wallet.profitBalance).toFixed(2));
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance } });
    const expectedProfit = Number((amount * Number(contract.expectedReturnRate || 0) / 100).toFixed(4));
    const vault = await dataAccess.investmentVault.create({ userId: updatedUser.id || updatedUser._id, amount: Number(amount.toFixed(4)), durationDays, expectedReturnRate: contract.expectedReturnRate, expectedProfit, maturityDate: new Date(Date.now() + durationDays * 86400000), incentiveStatus: 'pending' });
    await dataAccess.transaction.create({ userId: updatedUser.id || updatedUser._id, type: 'vault_lock', amount, grossAmount: amount, usdtAmount: amount, walletAddress: `Investment Vault lock ${vault.id || vault._id}`, status: 'approved' });
    res.status(201).json({ success: true, message: 'تم تجميد USDT داخل خزنة الاستثمار بنجاح. الحافز المستقبلي غير مضمون ويخضع لسياسة المنصة.', vault, wallet: updatedUser.wallet, USDT_balance: updatedUser.USDT_balance });
  } catch (error) {
    console.error('Supabase vault creation error:', error.message);
    res.status(500).json({ error: 'تعذر إنشاء خزنة الاستثمار' });
  }
}

async function getVaults(req, res) {
  try {
    const vaults = dataAccess.isSupabaseRuntime()
      ? await dataAccess.investmentVault.find({ userId: req.user.id }, { sort: { createdAt: -1 } })
      : await InvestmentVault.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    const now = Date.now();
    res.json({ success: true, vaults: vaults.map(vault => ({ ...vault, status: vault.status === 'active' && new Date(vault.maturityDate).getTime() <= now ? 'matured' : vault.status })) });
  } catch (error) {
    if (dataAccess.isSupabaseRuntime()) return res.json({ success: true, vaults: [], storageUnavailable: true });
    res.status(500).json({ error: 'تعذر تحميل خزائن الاستثمار' });
  }
}

async function claimVault(req, res) {
  if (dataAccess.isSupabaseRuntime()) return claimVaultSupabase(req, res);
  const session = await mongoose.startSession();
  try {
    let user;
    let vault;
    await session.withTransaction(async () => {
      vault = await InvestmentVault.findOne({ _id: req.body.vaultId, userId: req.user.id }).session(session);
      if (!vault) throw Object.assign(new Error('VAULT_NOT_FOUND'), { statusCode: 404 });
      if (vault.status === 'claimed') throw Object.assign(new Error('VAULT_CLAIMED'), { statusCode: 400 });
      if (new Date() < new Date(vault.maturityDate)) throw Object.assign(new Error('VAULT_LOCKED'), { statusCode: 400 });
      user = await User.findById(req.user.id).session(session);
      vault.status = 'claimed';
      await vault.save({ session });
      const releaseAmount = Number((vault.amount + vault.incentiveAmount).toFixed(4));
      user.USDT_balance = Number((Number(user.USDT_balance || 0) + releaseAmount).toFixed(4));
      user.wallet.profitBalance = Number((Number(user.wallet.profitBalance || 0) + releaseAmount).toFixed(4));
      user.syncWallet();
      await user.save({ session });
      await new Transaction({ userId: user._id, type: 'vault_release', amount: releaseAmount, grossAmount: releaseAmount, usdtAmount: releaseAmount, walletAddress: `Investment Vault release ${vault._id}`, status: 'approved' }).save({ session });
    });
    await realtimeService.publish('user_data_changed', { reason: 'vault_claimed', timestamp: new Date().toISOString() }, { userId: user._id });
    await realtimeService.publish('admin_transaction_created', { type: 'vault_release', userId: user._id, vaultId: vault._id }, { scope: 'admin' });
    res.json({ success: true, message: 'تم فك تجميد خزنة الاستثمار وإعادة USDT إلى رصيدك. أي حافز يخضع للاعتماد وفق سياسة المنصة.', vault, wallet: user.wallet, USDT_balance: user.USDT_balance });
  } catch (error) {
    const errors = { VAULT_NOT_FOUND: [404, 'خزنة الاستثمار غير موجودة'], VAULT_CLAIMED: [400, 'تم استرداد هذه الخزنة مسبقًا'], VAULT_LOCKED: [400, 'لا يمكن استرداد الخزنة قبل تاريخ الاستحقاق'] };
    if (errors[error.message]) return res.status(errors[error.message][0]).json({ error: errors[error.message][1] });
    console.error('Error claiming investment vault:', error);
    res.status(500).json({ error: 'تعذر استرداد خزنة الاستثمار' });
  } finally { await session.endSession(); }
}

async function claimVaultSupabase(req, res) {
  try {
    const vault = await dataAccess.investmentVault.findOne({ id: req.body.vaultId, userId: req.user.id });
    if (!vault) return res.status(404).json({ error: 'خزنة الاستثمار غير موجودة' });
    if (vault.status === 'claimed') return res.status(400).json({ error: 'تم استرداد هذه الخزنة مسبقًا' });
    if (new Date() < new Date(vault.maturityDate)) return res.status(400).json({ error: 'لا يمكن استرداد الخزنة قبل تاريخ الاستحقاق' });
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const releaseAmount = Number((Number(vault.amount || 0) + Number(vault.incentiveAmount || 0)).toFixed(4));
    user.USDT_balance = Number((Number(user.USDT_balance || 0) + releaseAmount).toFixed(4));
    user.wallet.profitBalance = Number((Number(user.wallet.profitBalance || 0) + releaseAmount).toFixed(4));
    user.wallet.balance = Number((Number(user.wallet.depositBalance || 0) + user.wallet.profitBalance).toFixed(2));
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance } });
    const updatedVault = await dataAccess.investmentVault.updateOne({ id: vault.id || vault._id, status: vault.status }, { $set: { status: 'claimed' } });
    if (!updatedVault) return res.status(409).json({ error: 'تم استرداد هذه الخزنة مسبقًا' });
    await dataAccess.transaction.create({ userId: updatedUser.id || updatedUser._id, type: 'vault_release', amount: releaseAmount, grossAmount: releaseAmount, usdtAmount: releaseAmount, walletAddress: `Investment Vault release ${vault.id || vault._id}`, status: 'approved' });
    res.json({ success: true, message: 'تم فك تجميد خزنة الاستثمار وإعادة USDT إلى رصيدك. أي حافز يخضع للاعتماد وفق سياسة المنصة.', vault: { ...vault, status: 'claimed' }, wallet: updatedUser.wallet, USDT_balance: updatedUser.USDT_balance });
  } catch (error) {
    console.error('Supabase vault claim error:', error.message);
    res.status(500).json({ error: 'تعذر استرداد خزنة الاستثمار' });
  }
}

module.exports = { createVault, getVaults, claimVault, getVaultContracts };