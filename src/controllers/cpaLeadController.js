const realtimeService = require('../services/realtimeService');
const { applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');
const dataAccess = require('../services/dataAccess');

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
  return postbackSupabase(req, res, leadId, subid, payoutUsd);
}

async function postbackSupabase(req, res, leadId, subid, payoutUsd) {
  try {
    const user = await dataAccess.user.findById(subid);
    if (!user || user.isBanned) return res.status(404).send('user_not_found');
    if (await dataAccess.cpaLeadConversion.findOne({ leadId })) return res.status(200).send('ok');
    const rewardShare = Math.min(1, Math.max(0, Number(process.env.CPALEAD_USER_REWARD_SHARE || 0.7)));
    const split = applyRewardToUser(user, payoutUsd * rewardShare);
    user.assetWallet = Number((Number(user.assetWallet || 0) + split.grossAmount).toFixed(4));
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance, OPX_balance: user.OPX_balance, assetWallet: user.assetWallet } });
    await dataAccess.transaction.create({ userId: user.id || user._id, type: 'reward', ...rewardTransactionFields(split), walletAddress: `CPAlead Offerwall: ${clean(req.query.campaign_name || req.query.campaign_id, 120) || 'Conversion'}`, status: 'approved', idempotencyKey: `cpalead:${leadId}` });
    await dataAccess.notification.create({ userId: user.id || user._id, title: 'تمت إضافة مكافأة Offerwall', body: `تم اعتماد مكافأة CPAlead وإضافة ${split.usdtAmount.toFixed(4)} USDT و${split.opxAmount.toFixed(4)} OPX إلى محفظتك.`, type: 'transaction' });
    await dataAccess.cpaLeadConversion.create({ leadId, userId: user.id || user._id, campaignId: clean(req.query.campaign_id, 120), eventKey: clean(req.query.event_key, 120), payoutUsd, creditedGross: split.grossAmount, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount });
    realtimeService.emit('wallet_updated', { reason: 'cpalead_offerwall_reward', assetWallet: updatedUser.assetWallet, USDT_balance: updatedUser.USDT_balance, OPX_balance: updatedUser.OPX_balance, wallet: updatedUser.wallet }, { userId: user.id || user._id });
    return res.status(200).send('ok');
  } catch (error) {
    if (error?.code === '23505') return res.status(200).send('ok');
    console.error('Supabase CPAlead postback error:', error.message);
    return res.status(500).send('retry');
  }
}

module.exports = { getOfferwall, postback };