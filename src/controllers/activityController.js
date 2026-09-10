const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Staking = require('../models/Staking');
const VipLevel = require('../models/VipLevel');
const dataAccess = require('../services/dataAccess');
const { syncGameCredits } = require('../services/gameAccess');

function splitHybridReward(amount) {
  const value = Number(amount) || 0;
  const usdtAmount = Number((value * 0.7).toFixed(4));
  const opxAmount = Number((value * 0.3).toFixed(4));
  return { usdtAmount, opxAmount };
}

function syncPlainWallet(user) {
  user.wallet = user.wallet || { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 };
  user.wallet.balance = Number((Number(user.wallet.depositBalance || 0) + Number(user.wallet.profitBalance || 0)).toFixed(2));
  user.USDT_balance = user.wallet.balance;
}

function getGameConfig(req, res) {
  const settings = req.app.locals.gameSettings;
  res.json({ success: true, settings: { spinMin: settings.spinMin, spinMax: settings.spinMax, boxMin: settings.boxMin, boxMax: settings.boxMax, dailyGameRewardCap: settings.dailyGameRewardCap, referralsPerCycle: settings.referralsPerCycle || 25 } });
}

async function getGameHistory(req, res) {
  try {
    const query = { userId: req.user.id, walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: { $in: ['approved', 'completed'] } };
    const history = dataAccess.isSupabaseRuntime()
      ? await dataAccess.transaction.find(query, { sort: { createdAt: -1 }, limit: 20, select: 'walletAddress amount createdAt' })
      : await Transaction.find(query).sort({ createdAt: -1 }).limit(20).select('walletAddress amount createdAt');
    res.json({ success: true, history });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل سجل الألعاب' }); }
}

async function getGameStats(req, res) {
  try {
    const query = { userId: req.user.id, type: 'reward', walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: 'approved' };
    let stats;
    if (dataAccess.isSupabaseRuntime()) {
      const transactions = await dataAccess.transaction.find(query);
      const grouped = new Map();
      transactions.forEach(transaction => {
        const current = grouped.get(transaction.walletAddress) || { _id: transaction.walletAddress, plays: 0, total: 0, lastPlayed: null };
        current.plays += 1;
        current.total += Number(transaction.amount || 0);
        if (!current.lastPlayed || new Date(transaction.createdAt) > new Date(current.lastPlayed)) current.lastPlayed = transaction.createdAt;
        grouped.set(transaction.walletAddress, current);
      });
      stats = [...grouped.values()];
    } else {
      stats = await Transaction.aggregate([{ $match: query }, { $group: { _id: '$walletAddress', plays: { $sum: 1 }, total: { $sum: '$amount' }, lastPlayed: { $max: '$createdAt' } } }]);
    }
    res.json({ success: true, stats });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل إحصاءات الألعاب' }); }
}

async function completeTask(req, res) {
  if (dataAccess.isSupabaseRuntime()) return completeTaskSupabase(req, res);
  const session = await mongoose.startSession();
  try {
    let updatedUser;
    await session.withTransaction(async () => {
      const user = await User.findById(req.user.id).session(session);
      if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
      const vipLevel = await VipLevel.findOne({ code: user.tierCode }).session(session);
      if (!vipLevel || !(user.wallet?.totalDeposits > 0)) {
        throw Object.assign(new Error('TIER_NOT_ACTIVATED'), { statusCode: 400 });
      }
      const maxTasks = vipLevel ? vipLevel.tasks : 33;
      const dailyProfit = vipLevel ? vipLevel.dailyProfit : 2.5;
      const commission = parseFloat((dailyProfit / maxTasks).toFixed(4));
      const split = splitHybridReward(commission);
      const userToUpdate = await User.findById(req.user.id).session(session);
      if (!userToUpdate) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
      if (userToUpdate.todayCompletedTasks >= maxTasks) throw Object.assign(new Error('TASK_LIMIT'), { statusCode: 400 });

      userToUpdate.assetWallet = Number((Number(userToUpdate.assetWallet || 0) + commission).toFixed(4));
      userToUpdate.wallet.profitBalance = Number((Number(userToUpdate.wallet.profitBalance || 0) + split.usdtAmount).toFixed(4));
      userToUpdate.USDT_balance = Number((Number(userToUpdate.USDT_balance || 0) + split.usdtAmount).toFixed(4));
      userToUpdate.OPX_balance = Number((Number(userToUpdate.OPX_balance || 0) + split.opxAmount).toFixed(4));
      userToUpdate.todayCompletedTasks = Number(userToUpdate.todayCompletedTasks || 0) + 1;
      userToUpdate.syncWallet();
      updatedUser = await userToUpdate.save({ session });
      await new Transaction({ userId: updatedUser._id, type: 'reward', amount: commission, grossAmount: commission, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount, walletAddress: 'Daily Task Reward', status: 'approved' }).save({ session });
    });
    res.json({ success: true, assetWallet: updatedUser.assetWallet, wallet: updatedUser.wallet, completed: updatedUser.todayCompletedTasks });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.statusCode === 404) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (err.message === 'TASK_LIMIT') return res.status(400).json({ error: 'لقد أتممت جميع مهام اليوم' });
    if (err.message === 'TIER_NOT_ACTIVATED') return res.status(400).json({ error: 'يجب إيداع قيمة المستوى وتفعيله قبل إنجاز المهام' });
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  } finally { await session.endSession(); }
}

async function completeTaskSupabase(req, res) {
  try {
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const vipLevel = await dataAccess.vipLevel.findOne({ code: user.tierCode });
    if (!vipLevel || !(user.wallet?.totalDeposits > 0)) return res.status(400).json({ error: 'يجب إيداع قيمة المستوى وتفعيله قبل إنجاز المهام' });
    const maxTasks = vipLevel.tasks || 33;
    if (Number(user.todayCompletedTasks || 0) >= maxTasks) return res.status(400).json({ error: 'لقد أتممت جميع مهام اليوم' });
    const commission = Number((Number(vipLevel.dailyProfit || 2.5) / maxTasks).toFixed(4));
    const split = splitHybridReward(commission);
    user.assetWallet = Number((Number(user.assetWallet || 0) + commission).toFixed(4));
    user.wallet.profitBalance = Number((Number(user.wallet.profitBalance || 0) + split.usdtAmount).toFixed(4));
    user.USDT_balance = Number((Number(user.USDT_balance || 0) + split.usdtAmount).toFixed(4));
    user.OPX_balance = Number((Number(user.OPX_balance || 0) + split.opxAmount).toFixed(4));
    user.todayCompletedTasks = Number(user.todayCompletedTasks || 0) + 1;
    syncPlainWallet(user);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { assetWallet: user.assetWallet, wallet: user.wallet, USDT_balance: user.USDT_balance, OPX_balance: user.OPX_balance, todayCompletedTasks: user.todayCompletedTasks } });
    await dataAccess.transaction.create({ userId: updatedUser.id || updatedUser._id, type: 'reward', amount: commission, grossAmount: commission, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount, walletAddress: 'Daily Task Reward', status: 'approved' });
    res.json({ success: true, assetWallet: updatedUser.assetWallet, wallet: updatedUser.wallet, completed: updatedUser.todayCompletedTasks });
  } catch (error) {
    console.error('Supabase task reward error:', error.message);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function reward(req, res, min, max, label) {
  if (dataAccess.isSupabaseRuntime()) return rewardSupabase(req, res, min, max, label);
  const session = await mongoose.startSession();
  try {
    let updatedUser;
    let rewardAmount;
    await session.withTransaction(async () => {
      const user = await User.findById(req.user.id).session(session);
      if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { statusCode: 404 });
      await syncGameCredits(user, session, req.app.locals.gameSettings);
      const creditField = label === 'Lucky Spin Wheel' ? 'wheelCredits' : 'mysteryBoxCredits';
      if (!user.tierCode || !user.wallet || !(user.wallet.totalDeposits > 0) || user[creditField] < 1) {
        throw Object.assign(new Error('GAME_REQUIRES_REFERRALS'), { statusCode: 400 });
      }
      user[creditField] -= 1;
      rewardAmount = parseFloat((Math.random() * (max - min) + min).toFixed(2));
      const split = splitHybridReward(rewardAmount);
      const dailyStart = new Date(); dailyStart.setUTCHours(0, 0, 0, 0);
      const dailyRewardTotal = await Transaction.aggregate([
        { $match: { userId: user._id, type: 'reward', walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: 'approved', createdAt: { $gte: dailyStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).session(session);
      if ((dailyRewardTotal[0]?.total || 0) + rewardAmount > (req.app.locals.gameSettings.dailyGameRewardCap || 100)) throw Object.assign(new Error('DAILY_GAME_CAP'), { statusCode: 400 });
      user.wallet.profitBalance = Number((Number(user.wallet.profitBalance || 0) + split.usdtAmount).toFixed(4));
      user.USDT_balance = Number((Number(user.USDT_balance || 0) + split.usdtAmount).toFixed(4));
      user.OPX_balance = Number((Number(user.OPX_balance || 0) + split.opxAmount).toFixed(4));
      user.syncWallet();
      updatedUser = await user.save({ session });
      await new Transaction({ userId: updatedUser._id, type: 'reward', amount: rewardAmount, grossAmount: rewardAmount, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount, walletAddress: label, status: 'approved' }).save({ session });
    });
    res.json({ success: true, reward: rewardAmount, wallet: updatedUser.wallet });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.statusCode === 404) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (err.message === 'GAME_REQUIRES_REFERRALS') return res.status(400).json({ error: 'تحتاج إلى 25 إحالة نشطة لفتح دورة العجلة والصندوق، مع إيداع وتفعيل مستوى الحساب' });
    if (err.message === 'DAILY_GAME_CAP') return res.status(400).json({ error: 'تم بلوغ الحد اليومي لمكافآت الألعاب، حاول غدًا' });
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  } finally { await session.endSession(); }
}

async function rewardSupabase(req, res, min, max, label) {
  try {
    const user = await dataAccess.user.findById(req.user.id);
    if (!user || !user.tierCode || !user.wallet || !(user.wallet.totalDeposits > 0)) return res.status(400).json({ error: 'تحتاج إلى 25 إحالة نشطة لفتح دورة العجلة والصندوق، مع إيداع وتفعيل مستوى الحساب' });
    const creditField = label === 'Lucky Spin Wheel' ? 'wheelCredits' : 'mysteryBoxCredits';
    if (Number(user[creditField] || 0) < 1) return res.status(400).json({ error: 'تحتاج إلى 25 إحالة نشطة لفتح دورة العجلة والصندوق، مع إيداع وتفعيل مستوى الحساب' });
    const rewardAmount = Number((Math.random() * (max - min) + min).toFixed(2));
    const split = splitHybridReward(rewardAmount);
    const history = await dataAccess.transaction.find({ userId: user.id || user._id, type: 'reward', walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: 'approved', createdAt: { $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } });
    const dailyTotal = history.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (dailyTotal + rewardAmount > (req.app.locals.gameSettings.dailyGameRewardCap || 100)) return res.status(400).json({ error: 'تم بلوغ الحد اليومي لمكافآت الألعاب، حاول غدًا' });
    user[creditField] = Number(user[creditField]) - 1;
    user.wallet.profitBalance = Number((Number(user.wallet.profitBalance || 0) + split.usdtAmount).toFixed(4));
    user.USDT_balance = Number((Number(user.USDT_balance || 0) + split.usdtAmount).toFixed(4));
    user.OPX_balance = Number((Number(user.OPX_balance || 0) + split.opxAmount).toFixed(4));
    syncPlainWallet(user);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { [creditField]: user[creditField], wallet: user.wallet, USDT_balance: user.USDT_balance, OPX_balance: user.OPX_balance } });
    await dataAccess.transaction.create({ userId: updatedUser.id || updatedUser._id, type: 'reward', amount: rewardAmount, grossAmount: rewardAmount, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount, walletAddress: label, status: 'approved' });
    res.json({ success: true, reward: rewardAmount, wallet: updatedUser.wallet });
  } catch (error) {
    console.error('Supabase game reward error:', error.message);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

const spinWheel = (req, res) => reward(req, res, req.app.locals.gameSettings.spinMin ?? 1, req.app.locals.gameSettings.spinMax ?? 10, 'Lucky Spin Wheel');
const mysteryBox = (req, res) => reward(req, res, req.app.locals.gameSettings.boxMin ?? 5, req.app.locals.gameSettings.boxMax ?? 25, 'Mystery Box');

async function createStaking(req, res) {
  if (dataAccess.isSupabaseRuntime()) return createStakingSupabase(req, res);
  const session = await mongoose.startSession();
  try {
    const { amount, durationDays } = req.body;
    const stakeAmount = Number(amount); const duration = Number(durationDays);
    if (!stakeAmount || stakeAmount <= 0) return res.status(400).json({ error: 'مبلغ التخزين غير صالح' });
    if (![7, 15, 30].includes(duration)) return res.status(400).json({ error: 'مدة التخزين المتاحة هي 7، 15، أو 30 يوماً فقط' });
    const profitRate = duration === 7 ? 0.05 : duration === 15 ? 0.12 : 0.30;
    let staking;
    await session.withTransaction(async () => {
      const user = await User.findById(req.user.id).session(session);
      if (!user || user.wallet.balance < stakeAmount) throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { statusCode: 400 });
      let remaining = stakeAmount;
      if (user.wallet.depositBalance >= remaining) user.wallet.depositBalance -= remaining;
      else { remaining -= user.wallet.depositBalance; user.wallet.depositBalance = 0; user.wallet.profitBalance -= remaining; }
      user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
      await user.save({ session });
      staking = await new Staking({ userId: user._id, amount: stakeAmount, durationDays: duration, profitRate, expectedProfit: parseFloat((stakeAmount * profitRate).toFixed(2)), endDate: new Date(Date.now() + duration * 86400000), status: 'active' }).save({ session });
    });
    res.json({ success: true, message: 'تم تفعيل حزمة التخزين بنجاح', staking });
  } catch (err) { if (err.statusCode) return res.status(err.statusCode).json({ error: 'رصيد المحفظة غير كافٍ لإنشاء حزمة التخزين' }); res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
  finally { await session.endSession(); }
}

async function createStakingSupabase(req, res) {
  try {
    const stakeAmount = Number(req.body.amount); const duration = Number(req.body.durationDays);
    if (!stakeAmount || stakeAmount <= 0) return res.status(400).json({ error: 'مبلغ التخزين غير صالح' });
    if (![7, 15, 30].includes(duration)) return res.status(400).json({ error: 'مدة التخزين المتاحة هي 7، 15، أو 30 يوماً فقط' });
    const profitRate = duration === 7 ? 0.05 : duration === 15 ? 0.12 : 0.30;
    const user = await dataAccess.user.findById(req.user.id);
    if (!user || Number(user.wallet?.balance || 0) < stakeAmount) return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ لإنشاء حزمة التخزين' });
    let remaining = stakeAmount;
    if (Number(user.wallet.depositBalance || 0) >= remaining) user.wallet.depositBalance -= remaining;
    else { remaining -= Number(user.wallet.depositBalance || 0); user.wallet.depositBalance = 0; user.wallet.profitBalance = Number(user.wallet.profitBalance || 0) - remaining; }
    syncPlainWallet(user);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance } });
    const staking = await dataAccess.staking.create({ userId: updatedUser.id || updatedUser._id, amount: stakeAmount, durationDays: duration, profitRate, expectedProfit: Number((stakeAmount * profitRate).toFixed(2)), endDate: new Date(Date.now() + duration * 86400000), status: 'active' });
    res.json({ success: true, message: 'تم تفعيل حزمة التخزين بنجاح', staking });
  } catch (error) {
    console.error('Supabase staking error:', error.message);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function getStakings(req, res) {
  try { res.json({ success: true, stakings: dataAccess.isSupabaseRuntime() ? await dataAccess.staking.find({ userId: req.user.id }, { sort: { createdAt: -1 } }) : await Staking.find({ userId: req.user.id }).sort({ createdAt: -1 }) }); }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function claimStaking(req, res) {
  if (dataAccess.isSupabaseRuntime()) return claimStakingSupabase(req, res);
  const session = await mongoose.startSession();
  try {
    let user;
    await session.withTransaction(async () => {
      const staking = await Staking.findOne({ _id: req.body.stakingId, userId: req.user.id }).session(session);
      if (!staking) throw Object.assign(new Error('STAKING_NOT_FOUND'), { statusCode: 404 });
      if (staking.status !== 'active') throw Object.assign(new Error('STAKING_CLAIMED'), { statusCode: 400 });
      if (new Date() < new Date(staking.endDate)) throw Object.assign(new Error('STAKING_LOCKED'), { statusCode: 400 });
      staking.status = 'claimed'; await staking.save({ session });
      user = await User.findById(req.user.id).session(session);
      user.wallet.depositBalance += staking.amount; user.wallet.profitBalance += staking.expectedProfit; user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance; await user.save({ session });
      await new Transaction({ userId: user._id, type: 'staking_reward', amount: staking.amount + staking.expectedProfit, walletAddress: 'Staking Pool Reward', status: 'approved' }).save({ session });
    });
    res.json({ success: true, message: 'تم استلام رأس المال والأرباح بنجاح', wallet: user.wallet });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    const errors = { STAKING_NOT_FOUND: [404, 'حزمة التخزين غير موجودة'], STAKING_CLAIMED: [400, 'هذه الحزمة منتهية أو تم استلام أرباحها مسبقاً'], STAKING_LOCKED: [400, 'لم تنتهِ مدة التخزين المحددة بعد'] };
    if (errors[err.message]) return res.status(errors[err.message][0]).json({ error: errors[err.message][1] });
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  } finally { await session.endSession(); }
}

async function claimStakingSupabase(req, res) {
  try {
    const staking = await dataAccess.staking.findOne({ id: req.body.stakingId, userId: req.user.id });
    if (!staking) return res.status(404).json({ error: 'حزمة التخزين غير موجودة' });
    if (staking.status !== 'active') return res.status(400).json({ error: 'هذه الحزمة منتهية أو تم استلام أرباحها مسبقاً' });
    if (new Date() < new Date(staking.endDate)) return res.status(400).json({ error: 'لم تنتهِ مدة التخزين المحددة بعد' });
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const release = Number(staking.amount || 0) + Number(staking.expectedProfit || 0);
    user.wallet.depositBalance = Number(user.wallet.depositBalance || 0) + Number(staking.amount || 0);
    user.wallet.profitBalance = Number(user.wallet.profitBalance || 0) + Number(staking.expectedProfit || 0);
    syncPlainWallet(user);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance } });
    await dataAccess.staking.updateOne({ id: staking.id || staking._id }, { $set: { status: 'claimed' } });
    await dataAccess.transaction.create({ userId: updatedUser.id || updatedUser._id, type: 'staking_reward', amount: release, walletAddress: 'Staking Pool Reward', status: 'approved' });
    res.json({ success: true, message: 'تم استلام رأس المال والأرباح بنجاح', wallet: updatedUser.wallet });
  } catch (error) {
    console.error('Supabase staking claim error:', error.message);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

module.exports = { completeTask, spinWheel, mysteryBox, getGameConfig, getGameHistory, getGameStats, createStaking, getStakings, claimStaking };
