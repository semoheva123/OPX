const dataAccess = require('../services/dataAccess');

function idOf(value) {
  return String(value?.id || value?._id || '');
}

function labelFor(user) {
  return user.isOfficialPlatform ? 'OPERIX Official' : user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email || '').slice(0, 2)}•••`;
}

function toClientPost(post) {
  if (post && post.imageUrl !== undefined && post.image_url === undefined) post.image_url = post.imageUrl;
  return post;
}

async function toggleFollow(req, res) {
  try {
    const followingId = String(req.params.userId);
    if (followingId === String(req.user.id)) return res.status(400).json({ error: 'لا يمكنك متابعة حسابك' });
    const user = await dataAccess.user.findById(followingId);
    if (!user || user.isBanned) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const existing = await dataAccess.socialFollow.findOne({ followerId: req.user.id, followingId });
    if (user.isOfficialPlatform && existing) return res.json({ success: true, following: true, locked: true });
    if (existing) {
      await dataAccess.socialFollow.deleteOne({ id: idOf(existing) });
      return res.json({ success: true, following: false });
    }
    await dataAccess.socialFollow.create({ followerId: req.user.id, followingId });
    res.json({ success: true, following: true });
  } catch (error) {
    if (error.code === '23505') return res.json({ success: true, following: true });
    res.status(500).json({ error: 'تعذر تحديث المتابعة' });
  }
}

async function listCommunity(req, res) {
  try {
    const users = await dataAccess.user.find({ isBanned: false }, { sort: { createdAt: -1 }, limit: 31 });
    const visibleUsers = users.filter(user => idOf(user) !== String(req.user.id)).slice(0, 30);
    const following = await dataAccess.socialFollow.find({ followerId: req.user.id }, { limit: 500 });
    const followingIds = new Set(following.map(item => String(item.followingId)));
    const result = await Promise.all(visibleUsers.map(async user => {
      const id = idOf(user);
      const [posts, followers] = await Promise.all([
        dataAccess.socialPost.countDocuments({ authorId: id, status: 'visible' }),
        dataAccess.socialFollow.countDocuments({ followingId: id })
      ]);
      return { id, label: labelFor(user), isOfficialPlatform: Boolean(user.isOfficialPlatform), profileImage: user.profileImage || '', coverImage: user.coverImage || '', socialBio: user.socialBio || '', following: followingIds.has(id), posts, followers };
    }));
    res.json({ success: true, users: result });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل أعضاء المجتمع' }); }
}

async function getSocialProfile(req, res) {
  try {
    const user = await dataAccess.user.findOne({ id: req.params.userId, isBanned: false });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const [posts, followers, following, relation] = await Promise.all([
      dataAccess.socialPost.find({ authorId: idOf(user), status: 'visible' }, { sort: { createdAt: -1 }, limit: 6, select: 'content imageUrl createdAt likeCount' }).then(posts => posts.map(toClientPost)),
      dataAccess.socialFollow.countDocuments({ followingId: idOf(user) }),
      dataAccess.socialFollow.countDocuments({ followerId: idOf(user) }),
      dataAccess.socialFollow.findOne({ followerId: req.user.id, followingId: idOf(user) })
    ]);
    res.json({ success: true, profile: { id: idOf(user), label: labelFor(user), isOfficialPlatform: Boolean(user.isOfficialPlatform), profileImage: user.profileImage || '', coverImage: user.coverImage || '', socialBio: user.socialBio || '', posts, followers, following, isFollowing: Boolean(relation) } });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل بطاقة المستخدم' }); }
}

module.exports = { toggleFollow, listCommunity, getSocialProfile };
