const dataAccess = require('../services/dataAccess');
const { applyRewardToUser, rewardTransactionFields } = require('../services/hybridRewardLedger');
const { OPX_INTERNAL_USD_PRICE, OPX_FUTURE_LISTING_USD_PRICE, OPX_MAX_UPGRADE_DISCOUNT_SHARE, OPX_MIN_USDT_UPGRADE_SHARE, OPX_MAX_UPGRADE_VALUE_USD, calculateOpxForUsd, applyOpxUpgradePayment } = require('../services/opxPricing');

function getOpxPricing(req, res) {
  res.json({ symbol: 'OPX', internalUsdPrice: OPX_INTERNAL_USD_PRICE, futureListingUsdPrice: OPX_FUTURE_LISTING_USD_PRICE, upgradeRate: calculateOpxForUsd(1), maxUpgradeDiscountShare: OPX_MAX_UPGRADE_DISCOUNT_SHARE, maxUpgradeValueUsd: OPX_MAX_UPGRADE_VALUE_USD, minUsdtUpgradeShare: OPX_MIN_USDT_UPGRADE_SHARE });
}

async function getOpxMarketData(req, res) {
  try {
    const timeframeMap = { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1D' };
    const timeframe = timeframeMap[String(req.query.timeframe || '15m')] || '15m';
    const [tickerResponse, candlesResponse] = await Promise.all([
      fetch('https://api-pub.bitfinex.com/v2/ticker/tOPXUSD'),
      fetch(`https://api-pub.bitfinex.com/v2/candles/trade:${timeframe}:tOPXUSD/hist?limit=96&sort=-1`)
    ]);
    if (!tickerResponse.ok || !candlesResponse.ok) throw new Error('BITFINEX_UNAVAILABLE');
    const ticker = await tickerResponse.json();
    const candles = await candlesResponse.json();
    if (!Array.isArray(ticker) || !Array.isArray(candles)) throw new Error('INVALID_BITFINEX_RESPONSE');
    res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    const normalizedCandles = candles
      .map(candle => ({ timestamp: candle[0], open: Number(candle[1]), close: Number(candle[2]), high: Number(candle[3]), low: Number(candle[4]), volume: Number(candle[5]) }))
      .filter(candle => [candle.timestamp, candle.open, candle.close, candle.high, candle.low, candle.volume].every(Number.isFinite))
      .reverse();
    res.json({ source: 'Bitfinex', symbol: 'OPXUSD', network: 'Optimism', timeframe, price: Number(ticker[6]), dailyChange: Number(ticker[4]), dailyChangePercent: Number(ticker[5]) * 100, volume24h: Number(ticker[7]), candles: normalizedCandles });
  } catch (error) {
    res.status(502).json({ error: 'تعذر تحميل بيانات OPX الحقيقية من Bitfinex' });
  }
}

async function getVipLevels(req, res) {
  try {
    const levels = dataAccess.isSupabaseRuntime()
      ? await dataAccess.vipLevel.find()
      : await VipLevel.find().sort({ price: 1 });
    res.json(levels.sort((first, second) => Number(first.price || 0) - Number(second.price || 0)));
  }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function leaderboard(req, res) {
  try {
    const users = dataAccess.isSupabaseRuntime()
      ? (await dataAccess.user.find({ isBanned: false }, { select: 'email tierCode', limit: 100 })).sort((first, second) => Number(second.wallet?.balance || 0) - Number(first.wallet?.balance || 0)).slice(0, 10)
      : await User.find({ isBanned: false }).sort({ 'wallet.balance': -1 }).limit(10).select('email wallet.balance tierCode');
    const result = users.map((user, index) => {
      const [name, domain] = user.email.split('@');
      return { rank: index + 1, email: name.length > 3 ? `${name.substring(0, 3)}***@${domain}` : `***@${domain}`, balance: user.wallet?.balance || 0, tierCode: user.tierCode };
    });
    res.json({ success: true, leaderboard: result });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function liveActivity(req, res) {
  try {
    const [transactions, referrals] = dataAccess.isSupabaseRuntime()
      ? await Promise.all([
        dataAccess.transaction.find({ status: { $in: ['approved', 'completed'] } }, { sort: { createdAt: -1 }, limit: 20, select: 'userId type amount createdAt' }),
        dataAccess.user.find({ isBanned: false, referredBy: { $ne: null } }, { sort: { createdAt: -1 }, limit: 20, select: 'email createdAt' })
      ])
      : await Promise.all([
        Transaction.find({ status: { $in: ['approved', 'completed'] } }).sort({ createdAt: -1 }).limit(20).select('userId type amount createdAt'),
        User.find({ referredBy: { $exists: true, $ne: null }, isBanned: false }).sort({ createdAt: -1 }).limit(20).select('email createdAt')
      ]);
    const transactionEvents = transactions.map(transaction => ({
      id: `transaction-${transaction._id}`,
      type: transaction.type,
      amount: Number(transaction.amount) || 0,
      createdAt: transaction.createdAt
    }));
    const referralEvents = referrals.map(user => ({
      id: `referral-${user._id}`,
      type: 'referral',
      amount: 0,
      createdAt: user.createdAt
    }));
    const events = [...transactionEvents, ...referralEvents]
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
      .slice(0, 20);
    res.json({ success: true, events });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل نشاط المنصة' }); }
}

async function upgrade(req, res) {
  return upgradeSupabase(req, res);
}

async function upgradeSupabase(req, res) {
  try {
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const levels = await dataAccess.vipLevel.find({}, { sort: { price: 1 } });
    const codes = levels.map(level => level.code);
    let nextCode = req.body.targetTier;
    const currentIndex = codes.indexOf(user.tierCode);
    if (!nextCode) {
      if (currentIndex < 0 || currentIndex === codes.length - 1) return res.status(400).json({ error: 'أنت في المستوى الأقصى بالفعل' });
      nextCode = codes[currentIndex + 1];
    }
    const targetLevel = levels.find(level => level.code === nextCode);
    if (!targetLevel) return res.status(400).json({ error: 'المستوى المطلوب غير موجود' });
    const targetIndex = codes.indexOf(targetLevel.code);
    const currentLevel = levels.find(level => level.code === user.tierCode);
    const currentActivated = Boolean(currentLevel && Number(user.wallet?.totalDeposits || 0) > 0);
    const initialActivation = targetIndex === currentIndex && !currentActivated;
    if (targetIndex < currentIndex || (targetIndex === currentIndex && currentActivated)) return res.status(400).json({ error: 'يمكنك الترقية فقط إلى مستوى أعلى من مستواك الحالي' });
    if (targetIndex > currentIndex + 1) return res.status(400).json({ error: 'يجب إكمال المستويات بالترتيب، لا يمكنك تجاوز المستوى التالي' });
    const requiredReferrals = targetIndex * 10;
    const activeReferrals = await dataAccess.user.countDocuments({ referredBy: String(user.referralCode || '').trim().toUpperCase(), isBanned: false });
    if (activeReferrals < requiredReferrals) return res.status(400).json({ error: `تحتاج إلى ${requiredReferrals} إحالة نشطة مرتبطة بفريقك للترقية. لديك حاليًا ${activeReferrals} إحالة نشطة.` });
    const upgradeCost = targetIndex === currentIndex ? Number(targetLevel.price) : Math.max(0, Number(targetLevel.price) - Number(currentLevel?.price || 0));
    let payment;
    try { payment = applyOpxUpgradePayment(user, upgradeCost, { allowOpx: !initialActivation }); }
    catch (error) { return res.status(400).json({ error: `رصيد الإيداع غير كافٍ للترقية إلى ${targetLevel.name}` }); }
    const referrer = user.referredBy ? await dataAccess.user.findOne({ referralCode: user.referredBy }) : null;
    const result = await dataAccess.callSupabaseRpc('operix_upgrade_atomic', {
      p_user_id: user.id || user._id,
      p_expected_tier: user.tierCode,
      p_target_tier: targetLevel.code,
      p_upgrade_cost: payment.upgradeCost,
      p_usdt_amount: payment.usdtAmount,
      p_opx_amount: payment.opxAmount,
      p_opx_value: payment.opxValue || 0,
      p_referrer_id: referrer?.id || referrer?._id || null,
      p_referral_commission: referrer ? Number((payment.upgradeCost * 0.1).toFixed(2)) : 0,
      p_target_name: targetLevel.name
    });
    const updatedUser = result.user;
    res.json({ success: true, message: `تمت الترقية بنجاح إلى ${targetLevel.name}.`, tierCode: updatedUser.tierCode, wallet: result.wallet, OPX_balance: result.wallet?.OPX_balance, upgradeCost, opxAmount: payment.opxAmount, usdtAmount: payment.usdtAmount, initialActivation: payment.opxAmount === 0 && payment.usdtAmount === upgradeCost });
  } catch (error) {
    console.error('Supabase upgrade error:', error.message);
    res.status(500).json({ error: 'خطأ تقني أثناء معالجة الترقية' });
  }
}

module.exports = { getVipLevels, getOpxPricing, getOpxMarketData, leaderboard, liveActivity, upgrade };
