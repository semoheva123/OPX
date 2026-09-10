const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Staking = require('../models/Staking');
const VipLevel = require('../models/VipLevel');
const { syncGameCredits } = require('../services/gameAccess');

function splitHybridReward(amount) {
  const value = Number(amount) || 0;
  const usdtAmount = Number((value * 0.7).toFixed(4));
  const opxAmount = Number((value * 0.3).toFixed(4));
  return { usdtAmount, opxAmount };
}

function getGameConfig(req, res) {
  const settings = req.app.locals.gameSettings;
  res.json({ success: true, settings: { spinMin: settings.spinMin, spinMax: settings.spinMax, boxMin: settings.boxMin, boxMax: settings.boxMax, dailyGameRewardCap: settings.dailyGameRewardCap, referralsPerCycle: settings.referralsPerCycle || 25 } });
}

async function getGameHistory(req, res) {
  try {
    const history = await Transaction.find({ userId: req.user.id, walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: { $in: ['approved', 'completed'] } }).sort({ createdAt: -1 }).limit(20).select('walletAddress amount createdAt');
    res.json({ success: true, history });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل سجل الألعاب' }); }
}

async function getGameStats(req, res) {
  try {
    const stats = await Transaction.aggregate([{ $match: { userId: req.user.id, type: 'reward', walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: 'approved' } }, { $group: { _id: '$walletAddress', plays: { $sum: 1 }, total: { $sum: '$amount' }, lastPlayed: { $max: '$createdAt' } } }]);
    res.json({ success: true, stats });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل إحصاءات الألعاب' }); }
}

async function completeTask(req, res) {
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

async function reward(req, res, min, max, label) {
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

const spinWheel = (req, res) => reward(req, res, req.app.locals.gameSettings.spinMin ?? 1, req.app.locals.gameSettings.spinMax ?? 10, 'Lucky Spin Wheel');
const mysteryBox = (req, res) => reward(req, res, req.app.locals.gameSettings.boxMin ?? 5, req.app.locals.gameSettings.boxMax ?? 25, 'Mystery Box');

async function createStaking(req, res) {
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

async function getStakings(req, res) {
  try { res.json({ success: true, stakings: await Staking.find({ userId: req.user.id }).sort({ createdAt: -1 }) }); }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function claimStaking(req, res) {
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

module.exports = { completeTask, spinWheel, mysteryBox, getGameConfig, getGameHistory, getGameStats, createStaking, getStakings, claimStaking };
