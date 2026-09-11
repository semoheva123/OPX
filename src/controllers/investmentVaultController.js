const realtimeService = require('../services/realtimeService');
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
  return createVaultSupabase(req, res);
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
  return claimVaultSupabase(req, res);
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