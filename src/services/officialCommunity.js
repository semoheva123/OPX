const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dataAccess = require('./dataAccess');

const OFFICIAL_EMAIL = String(process.env.OFFICIAL_PLATFORM_EMAIL || 'official@operix.website').trim().toLowerCase();
const OFFICIAL_REFERRAL_CODE = 'OPERIXOFFICIAL';
const OFFICIAL_BIO = 'الحساب الرسمي لمنصة OPERIX. أخبار المنصة وتحديثاتها الرسمية.';

async function findOfficial() {
  const byEmail = await dataAccess.user.findOne({ email: OFFICIAL_EMAIL });
  return byEmail;
}

async function ensureOfficialCommunityAccount() {
  let official = await dataAccess.user.findOne({ email: OFFICIAL_EMAIL });
  if (!official) official = await dataAccess.user.findOne({ isOfficialPlatform: true });

  if (!official) {
    official = await dataAccess.user.create({
      email: OFFICIAL_EMAIL,
      password: await bcrypt.hash(process.env.OFFICIAL_PLATFORM_PASSWORD || crypto.randomBytes(32).toString('hex'), 12),
      role: 'admin',
      referralCode: OFFICIAL_REFERRAL_CODE,
      emailVerified: true,
      socialBio: OFFICIAL_BIO,
      metadata: { officialPlatform: true },
      termsAcceptedAt: new Date()
    });
  } else {
    official = await dataAccess.user.updateOne({ id: official.id }, {
      email: OFFICIAL_EMAIL,
      role: 'admin',
      referralCode: OFFICIAL_REFERRAL_CODE,
      emailVerified: true,
      socialBio: OFFICIAL_BIO,
      metadata: { ...(official.metadata || {}), officialPlatform: true }
    });
  }

  return official;
}

async function followOfficialCommunityAccount(userId) {
  const official = await findOfficial();
  if (!official || String(userId) === String(official.id)) return;
  const existing = await dataAccess.socialFollow.findOne({ followerId: userId, followingId: official.id });
  if (!existing) {
    try { await dataAccess.socialFollow.create({ followerId: userId, followingId: official.id }); } catch (error) {
      if (error.code !== '23505') throw error;
    }
  }
}

async function followOfficialForExistingUsers() {
  const official = await findOfficial();
  if (!official) return;
  const users = await dataAccess.user.find({ isBanned: false }, { limit: 10000 });
  for (const user of users) {
    if (String(user.id) !== String(official.id)) await followOfficialCommunityAccount(user.id);
  }
}

module.exports = { ensureOfficialCommunityAccount, followOfficialCommunityAccount, followOfficialForExistingUsers };
