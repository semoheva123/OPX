const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const CpaLeadConversion = require('../models/CpaLeadConversion');
const realtimeService = require('../services/realtimeService');
const { applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function number(value) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function offerwallEnabled() {
  return Boolean(String(process.env.CPALEAD_WALL_SLUG || '').trim());
}

function getOfferwall(req, res) {
  if (!offerwallEnabled()) return res.status(503).json({ error: 'جدار العروض غير مفعّل بعد' });
  const slug = encodeURIComponent(String(process.env.CPALEAD_WALL_SLUG).trim());
  const userId = encodeURIComponent(String(req.user.id));
  res.json({ success: true, url: `https://www.cpalead.com/wall/${slug}?subid=${userId}` });
}

async function postback(req, res) {
  const expectedPassword = String(process.env.CPALEAD_POSTBACK_PASSWORD || '').trim();
  const suppliedPassword = clean(req.query.password, 300);
  if (!expectedPassword || suppliedPassword !== expectedPassword) return res.status(401).send('invalid');
  const leadId = clean(req.query.lead_id || req.query.leadid, 120);
  const subid = clean(req.query.subid || req.query.user_id, 120);
  const payoutUsd = number(req.query.payout ?? req.query.event_payout ?? req.query.amount);
  if (!leadId || !subid || payoutUsd === null) return res.status(400).send('invalid');
  if (!mongoose.isValidObjectId(subid)) return res.status(400).send('invalid');
  const user = await User.findById(subid);
  if (!user || user.isBanned) return res.status(404).send('user_not_found');
  const session = await mongoose.startSession();
  let snapshot;
  let credited = false;
  try {
    await session.withTransaction(async () => {
      const existing = await CpaLeadConversion.findOne({ leadId }).session(session);
      if (existing) return;
      const userInTransaction = await User.findById(user._id).session(session);
      const rewardShare = Math.min(1, Math.max(0, Number(process.env.CPALEAD_USER_REWARD_SHARE || 0.7)));
      const split = applyRewardToUser(userInTransaction, payoutUsd * rewardShare);
      userInTransaction.assetWallet = Number((Number(userInTransaction.assetWallet || 0) + split.grossAmount).toFixed(4));
      await userInTransaction.save({ session });
      await new Transaction({ userId: userInTransaction._id, type: 'reward', ...rewardTransactionFields(split), walletAddress: `CPAlead Offerwall: ${clean(req.query.campaign_name || req.query.campaign_id, 120) || 'Conversion'}`, status: 'approved', idempotencyKey: `cpalead:${leadId}` }).save({ session });
      await new Notification({ userId: userInTransaction._id, title: 'تمت إضافة مكافأة Offerwall', body: `تم اعتماد مكافأة CPAlead وإضافة ${split.usdtAmount.toFixed(4)} USDT و${split.opxAmount.toFixed(4)} OPX إلى محفظتك.`, type: 'transaction' }).save({ session });
      await new CpaLeadConversion({ leadId, userId: userInTransaction._id, campaignId: clean(req.query.campaign_id, 120), eventKey: clean(req.query.event_key, 120), payoutUsd, creditedGross: split.grossAmount, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount }).save({ session });
      snapshot = { assetWallet: userInTransaction.assetWallet, USDT_balance: userInTransaction.USDT_balance, OPX_balance: userInTransaction.OPX_balance, wallet: userInTransaction.wallet };
      credited = true;
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(200).send('ok');
    console.error('CPAlead postback error:', error.message);
    return res.status(500).send('retry');
  } finally {
    await session.endSession();
  }
  if (credited && snapshot) realtimeService.emit('wallet_updated', { reason: 'cpalead_offerwall_reward', ...snapshot }, { userId: user._id });
  return res.status(200).send('ok');
}

module.exports = { getOfferwall, postback };