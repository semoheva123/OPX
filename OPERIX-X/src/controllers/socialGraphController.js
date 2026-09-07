const SocialFollow = require('../models/SocialFollow');
const User = require('../models/User');
const SocialPost = require('../models/SocialPost');

async function toggleFollow(req, res) {
  try {
    const followingId = String(req.params.userId);
    if (followingId === String(req.user.id)) return res.status(400).json({ error: 'لا يمكنك متابعة حسابك' });
    const user = await User.findById(followingId).select('_id isBanned');
    if (!user || user.isBanned) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const existing = await SocialFollow.findOne({ followerId: req.user.id, followingId });
    if (existing) {
      await existing.deleteOne();
      return res.json({ success: true, following: false });
    }
    await SocialFollow.create({ followerId: req.user.id, followingId });
    res.json({ success: true, following: true });
  } catch (error) {
    if (error.code === 11000) return res.json({ success: true, following: true });
    res.status(500).json({ error: 'تعذر تحديث المتابعة' });
  }
}

async function listCommunity(req, res) {
  try {
    const users = await User.find({ _id: { $ne: req.user.id }, isBanned: false })
      .select('email referralCode profileImage coverImage socialBio')
      .sort({ createdAt: -1 }).limit(30).lean();
    const following = await SocialFollow.find({ followerId: req.user.id, followingId: { $in: users.map(user => user._id) } }).select('followingId').lean();
    const followingIds = new Set(following.map(item => String(item.followingId)));
    const result = await Promise.all(users.map(async user => ({
      id: user._id,
      label: user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email).slice(0, 2)}•••`,
      profileImage: user.profileImage || '',
      coverImage: user.coverImage || '',
      socialBio: user.socialBio || '',
      following: followingIds.has(String(user._id)),
      posts: await SocialPost.countDocuments({ authorId: user._id, status: 'visible' }),
      followers: await SocialFollow.countDocuments({ followingId: user._id })
    })));
    res.json({ success: true, users: result });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل أعضاء المجتمع' }); }
}

async function getSocialProfile(req, res) {
  try {
    const user = await User.findOne({ _id: req.params.userId, isBanned: false }).select('email referralCode profileImage coverImage socialBio').lean();
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const [posts, followers, following, relation] = await Promise.all([
      SocialPost.find({ authorId: user._id, status: 'visible' }).sort({ createdAt: -1 }).limit(6).select('content image_url createdAt likeCount').lean(),
      SocialFollow.countDocuments({ followingId: user._id }),
      SocialFollow.countDocuments({ followerId: user._id }),
      SocialFollow.exists({ followerId: req.user.id, followingId: user._id })
    ]);
    res.json({ success: true, profile: { id: user._id, label: user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email).slice(0, 2)}•••`, profileImage: user.profileImage || '', coverImage: user.coverImage || '', socialBio: user.socialBio || '', posts, followers, following, isFollowing: Boolean(relation) } });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل بطاقة المستخدم' }); }
}

module.exports = { toggleFollow, listCommunity, getSocialProfile };
