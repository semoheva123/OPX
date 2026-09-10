const User = require('../models/User');

async function syncGameCredits(user, session, settings = {}) {
  let query = User.countDocuments({
    referredBy: user.referralCode?.trim().toUpperCase(),
    isBanned: false,
    'wallet.totalDeposits': { $gt: 0 }
  });
  if (session) query = query.session(session);
  const activeReferrals = await query;
  const referralsPerCycle = Math.max(1, Number(settings.referralsPerCycle) || 25);
  const entitledCycles = Math.floor(activeReferrals / referralsPerCycle);
  const grantedCycles = user.gameCyclesGranted || 0;
  const newCycles = Math.max(0, entitledCycles - grantedCycles);

  if (newCycles > 0) {
    user.gameCyclesGranted = grantedCycles + newCycles;
    user.wheelCredits = (user.wheelCredits || 0) + newCycles;
    user.mysteryBoxCredits = (user.mysteryBoxCredits || 0) + newCycles;
  }

  return { activeReferrals, newCycles };
}

module.exports = { syncGameCredits };
