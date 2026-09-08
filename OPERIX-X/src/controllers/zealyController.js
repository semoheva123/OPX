const crypto = require('crypto');
const ExternalTask = require('../models/ExternalTask');
const TaskCompletion = require('../models/TaskCompletion');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');

const ZEALY_API_BASE = 'https://api-v2.zealy.io';
const VALID_TIERS = ['A1', 'A2', 'A3', 'A4', 'A5'];

function configuredSubdomain() {
  return String(process.env.ZEALY_COMMUNITY_SUBDOMAIN || 'operixinsiders').trim().toLowerCase();
}

function configuredTaskRewards() {
  try {
    const parsed = JSON.parse(String(process.env.ZEALY_TASK_REWARDS_JSON || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn('Invalid ZEALY_TASK_REWARDS_JSON:', error.message);
    return {};
  }
}

function canAccessTier(userTier, minimumTier) {
  return VALID_TIERS.indexOf(String(userTier || 'A1').toUpperCase()) >= VALID_TIERS.indexOf(String(minimumTier || 'A1').toUpperCase());
}

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim().slice(0, 1000);
}

function questUrl(subdomain, communityId, questId) {
  return `https://zealy.io/cw/${encodeURIComponent(subdomain)}/questboard/${encodeURIComponent(communityId)}/${encodeURIComponent(questId)}`;
}

async function fetchZealyQuests() {
  const apiKey = String(process.env.ZEALY_API_KEY || '').trim();
  if (!apiKey) throw Object.assign(new Error('ZEALY_API_KEY_MISSING'), { statusCode: 503 });
  const subdomain = configuredSubdomain();
  const response = await fetch(`${ZEALY_API_BASE}/public/communities/${encodeURIComponent(subdomain)}/quests`, { headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || 'ZEALY_API_ERROR'), { statusCode: response.status });
  return { subdomain, payload };
}

async function listTasks(req, res) {
  try {
    const { subdomain, payload } = await fetchZealyQuests();
    const community = payload.community || payload.data?.community || payload;
    const quests = Array.isArray(payload) ? payload : payload.quests || payload.data?.quests || payload.data || [];
    const configuredRewards = configuredTaskRewards();
    const tasks = [];
      const defaultReward = Math.max(0, Number(process.env.ZEALY_DEFAULT_REWARD_USDT || 0) || 0);
    for (const quest of quests) {
      const externalId = safeText(quest.id);
      if (!externalId) continue;
      const task = await ExternalTask.findOneAndUpdate(
        { platform: 'zealy', externalId },
        {
          $set: {
            communitySubdomain: subdomain,
            title: safeText(quest.name || quest.title, 'مهمة Zealy'),
            description: safeText(quest.description || quest.categoryName),
            category: 'operations',
            xp: Number(quest.xp || 0),
              rewardUsdt: Object.prototype.hasOwnProperty.call(configuredRewards, externalId)
                ? Math.max(0, Number(configuredRewards[externalId]) || 0)
                : defaultReward,
            url: questUrl(subdomain, community.id || community._id || '', externalId),
            syncedAt: new Date()
          },
            $setOnInsert: { minimumTier: 'A1', active: true }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
      if (task.active && canAccessTier(req.user.tierCode, task.minimumTier)) tasks.push(task);
    }
    const completions = await TaskCompletion.find({ userId: req.user.id, taskId: { $in: tasks.map(task => task._id) }, status: 'approved' }).select('taskId').lean();
    const completedIds = new Set(completions.map(item => String(item.taskId)));
    res.json({ success: true, tasks: tasks.map(task => ({ ...task, completed: completedIds.has(String(task._id)) })) });
  } catch (error) {
    console.error('Zealy task list error:', error.message);
    res.status(error.statusCode || 502).json({ error: 'تعذر تحميل مهام Zealy حاليًا' });
  }
}

function sameSecret(received, expected) {
  const actualBuffer = Buffer.from(String(received || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length > 0 && actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function receiveWebhook(req, res) {
  const payload = req.body || {};
  if (!sameSecret(payload.secret, process.env.ZEALY_WEBHOOK_SECRET)) return res.status(401).json({ error: 'Webhook secret غير صالح' });
  if (payload.type !== 'QUEST_SUCCEEDED') return res.status(200).json({ success: true, ignored: true });
  try {
    const data = payload.data || {};
    const quest = data.quest || {};
    const userData = data.user || {};
    const subdomain = safeText(data.community?.subdomain || configuredSubdomain()).toLowerCase();
    const task = await ExternalTask.findOne({ platform: 'zealy', externalId: safeText(quest.id), communitySubdomain: subdomain, active: true });
    const user = userData.email ? await User.findOne({ email: String(userData.email).trim().toLowerCase() }) : null;
    if (!task || !user || !canAccessTier(user.tierCode, task.minimumTier)) return res.status(200).json({ success: true, processed: false });
    const existing = await TaskCompletion.findOne({ userId: user._id, taskId: task._id });
    if (existing) return res.status(200).json({ success: true, duplicate: true });
    const reward = Number(task.rewardUsdt || 0);
    let usdtAmount = 0;
    let opxAmount = 0;
    if (reward > 0) {
      const split = applyRewardToUser(user, reward);
      usdtAmount = split.usdtAmount;
      opxAmount = split.opxAmount;
      await user.save();
      await new Transaction({ userId: user._id, type: 'reward', ...rewardTransactionFields(split), walletAddress: `Zealy: ${task.title}`, status: 'approved', idempotencyKey: `zealy:${task._id}:${user._id}` }).save();
    }
    await TaskCompletion.create({ userId: user._id, taskId: task._id, platform: 'zealy', externalEventId: safeText(payload.id), externalUserId: safeText(userData.id), status: 'approved', rewardUsdt: usdtAmount, rewardOpx: opxAmount, verifiedAt: new Date() });
    res.status(200).json({ success: true, processed: true });
  } catch (error) {
    if (error?.code === 11000) return res.status(200).json({ success: true, duplicate: true });
    console.error('Zealy webhook error:', error.message);
    res.status(500).json({ error: 'تعذر معالجة حدث Zealy' });
  }
}

module.exports = { listTasks, receiveWebhook };