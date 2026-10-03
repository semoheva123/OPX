const dataAccess = require('./dataAccess');
const User = dataAccess.user;

function calculateGameCycleGrant(activeReferrals, referralsPerCycle = 6, grantedCycles = 0) {
  const threshold = Math.max(1, Number(referralsPerCycle) || 6);
  const entitledCycles = Math.floor(Math.max(0, Number(activeReferrals) || 0) / threshold);
  const alreadyGranted = Math.max(0, Number(grantedCycles) || 0);
  return { entitledCycles, newCycles: Math.max(0, entitledCycles - alreadyGranted) };
}

async function syncGameCredits(user, settings = {}, activeReferralCount = 0) {
  const activeReferrals = Math.max(0, Number(activeReferralCount) || 0);
  const referralsPerCycle = Math.max(1, Number(settings.referralsPerCycle) || 6);
  const { entitledCycles, newCycles } = calculateGameCycleGrant(activeReferrals, referralsPerCycle, user.gameCyclesGranted);

  if (newCycles > 0) {
    user.gameCyclesGranted = entitledCycles;
    user.wheelCredits = Number(user.wheelCredits || 0) + newCycles;
    user.mysteryBoxCredits = Number(user.mysteryBoxCredits || 0) + newCycles;
    await User.updateOne(
      { id: user.id || user._id },
      { gameCyclesGranted: user.gameCyclesGranted, wheelCredits: user.wheelCredits, mysteryBoxCredits: user.mysteryBoxCredits }
    );
  }

  return { activeReferrals, newCycles };
}

module.exports = { calculateGameCycleGrant, syncGameCredits };
