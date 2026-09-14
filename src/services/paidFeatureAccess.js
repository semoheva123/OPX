const OFFICIAL_TESTER_EMAIL = String(process.env.OFFICIAL_PLATFORM_EMAIL || 'official@operix.website').trim().toLowerCase();

function hasPaidFeatureAccess(user) {
  return String(user?.email || '').trim().toLowerCase() === OFFICIAL_TESTER_EMAIL;
}

module.exports = { OFFICIAL_TESTER_EMAIL, hasPaidFeatureAccess };
