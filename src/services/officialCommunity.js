const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dataAccess = require('./dataAccess');
const User = dataAccess.user;
const SocialFollow = dataAccess.socialFollow;

const OFFICIAL_EMAIL = String(process.env.OFFICIAL_PLATFORM_EMAIL || 'official@operix.website').trim().toLowerCase();
const OFFICIAL_REFERRAL_CODE = 'OPERIXOFFICIAL';

async function ensureOfficialCommunityAccount() {
  let official = await User.findOne({ $or: [{ isOfficialPlatform: true }, { email: OFFICIAL_EMAIL }] });
  if (!official) {
    official = await User.create({
      email: OFFICIAL_EMAIL,
      password: await bcrypt.hash(process.env.OFFICIAL_PLATFORM_PASSWORD || crypto.randomBytes(32).toString('hex'), 12),
      role: 'admin',
      referralCode: OFFICIAL_REFERRAL_CODE,
      isOfficialPlatform: true,
      emailVerified: true,
      socialBio: 'الحساب الرسمي لمنصة OPERIX. أخبار المنصة وتحديثاتها الرسمية.',
      termsAcceptedAt: new Date()
    });
  } else {
    official.role = 'admin';
    official.isOfficialPlatform = true;
    official.emailVerified = true;
    official.referralCode = OFFICIAL_REFERRAL_CODE;
    if (!official.socialBio) official.socialBio = 'الحساب الرسمي لمنصة OPERIX. أخبار المنصة وتحديثاتها الرسمية.';
    await official.save();
  }
  await SocialFollow.createIndexes();
  await SocialFollow.updateMany({ followingId: official._id }, { $setOnInsert: { followingId: official._id } }, { upsert: false });
  return official;
}

async function followOfficialCommunityAccount(userId) {
  const official = await User.findOne({ isOfficialPlatform: true }).select('_id').lean();
  if (!official || String(userId) === String(official._id)) return;
  await SocialFollow.updateOne({ followerId: userId, followingId: official._id }, { $setOnInsert: { followerId: userId, followingId: official._id } }, { upsert: true });
}

async function followOfficialForExistingUsers() {
  const official = await User.findOne({ isOfficialPlatform: true }).select('_id').lean();
  if (!official) return;
  const users = await User.find({ _id: { $ne: official._id }, isBanned: false }).select('_id').lean();
  if (!users.length) return;
  await SocialFollow.bulkWrite(users.map(user => ({ updateOne: { filter: { followerId: user._id, followingId: official._id }, update: { $setOnInsert: { followerId: user._id, followingId: official._id } }, upsert: true } })));
}

module.exports = { ensureOfficialCommunityAccount, followOfficialCommunityAccount, followOfficialForExistingUsers };
