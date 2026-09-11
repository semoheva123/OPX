const { moderateText } = require('../services/socialSafetyBot');
const realtimeService = require('../services/realtimeService');
const dataAccess = require('../services/dataAccess');

const MAX_IMAGE_DATA_LENGTH = 2 * 1024 * 1024;
const allowedImageHosts = new Set(['ibb.co', 'www.ibb.co', 'i.ibb.co', 'imgbb.com', 'www.imgbb.com']);

function extractHashtags(content) {
  const matches = String(content || '').matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{2,40})/gu);
  return [...new Set([...matches].map(match => match[1].toLocaleLowerCase('und')))].slice(0, 10);
}

function isAllowedImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowedImageHosts.has(url.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

function normalizeImageUrl(value) {
  const imageUrl = String(value || '').trim();
  if (!imageUrl) return '';
  if (!isAllowedImageUrl(imageUrl)) throw Object.assign(new Error('INVALID_IMAGE_URL'), { statusCode: 400 });
  return imageUrl.slice(0, 500);
}

function getId(value) {
  return String(value?.id || value?._id || '');
}

function isOfficialUser(user) {
  return Boolean(user?.isOfficialPlatform || user?.metadata?.officialPlatform || String(user?.email || '').toLowerCase() === 'official@operix.website');
}

function toClientPost(post) {
  if (post && post.imageUrl !== undefined && post.image_url === undefined) post.image_url = post.imageUrl;
  return post;
}

function scorePost(post, followingIds) {
  const ageHours = Math.max(0, (Date.now() - new Date(post.createdAt).getTime()) / 3600000);
  const comments = Array.isArray(post.comments) ? post.comments.filter(item => item.status === 'visible').length : 0;
  return (post.isPinned ? 1000 : 0) + Number(post.likeCount || 0) * 3 + comments * 2 + Number(post.shareCount || 0) * 4 + 24 / Math.pow(ageHours + 2, 0.7) + (followingIds.includes(String(post.authorId)) ? 5 : 0) + (post.imageUrl ? 1 : 0);
}

async function visiblePost(id) {
  return dataAccess.socialPost.findOne({ id: String(id), status: 'visible' });
}

async function listPosts(req, res) {
  try {
    const page = Math.min(Math.max(Number.parseInt(req.query.page, 10) || 1, 1), 20);
    const limit = 15;
    const feed = String(req.query.feed || 'all');
    const following = await dataAccess.socialFollow.find({ followerId: req.user.id }, { limit: 500 });
    const followingIds = following.map(item => String(item.followingId));
    const query = { status: 'visible' };
    if (feed === 'following') query.authorId = { $in: followingIds };
    const hashtag = String(req.query.hashtag || '').trim().replace(/^#/, '').toLocaleLowerCase('und');
    if (hashtag) query.hashtags = hashtag;
    const candidateLimit = feed === 'following' || hashtag ? limit : Math.min(limit * 4, 60);
    const posts = await dataAccess.socialPost.find(query, { sort: { isPinned: -1, createdAt: -1 }, limit: candidateLimit });
    if (feed !== 'following' && !hashtag) posts.sort((left, right) => scorePost(right, followingIds) - scorePost(left, followingIds));
    const pagePosts = posts.slice((page - 1) * limit, page * limit);
    const authorIds = pagePosts.map(post => post.authorId).filter(Boolean);
    const authors = authorIds.length ? await dataAccess.user.find({ id: { $in: authorIds }, isBanned: false }, { limit: authorIds.length }) : [];
    const authorMap = new Map(authors.map(author => [getId(author), author]));
    pagePosts.forEach(post => {
      toClientPost(post);
      const author = authorMap.get(String(post.authorId));
      post.authorProfileImage = author?.profileImage || '';
      post.authorCoverImage = author?.coverImage || '';
      post.authorBio = author?.socialBio || '';
      post.authorIsOfficial = isOfficialUser(author);
      post.isSaved = Array.isArray(post.savedBy) && post.savedBy.some(id => String(id) === String(req.user.id));
      delete post.savedBy;
      delete post.reportedBy;
      delete post.likedBy;
    });
    res.json({ success: true, posts: pagePosts, page, hasMore: posts.length === candidateLimit && pagePosts.length === limit });
  } catch (error) {
    console.error('Social feed list error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل جدار التواصل حالياً' });
  }
}

async function createPost(req, res) {
  try {
    const content = String(req.body?.content || '').trim();
    if (content.length < 2 || content.length > 500) return res.status(400).json({ error: 'يجب أن يتراوح المنشور بين حرفين و500 حرف' });
    const moderation = moderateText(content);
    const imageUrl = normalizeImageUrl(req.body?.image_url);
    if (await dataAccess.socialPost.exists({ authorId: req.user.id, createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } })) return res.status(429).json({ error: 'انتظر خمس دقائق قبل نشر منشور جديد' });
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const authorLabel = isOfficialUser(user) ? 'OPERIX Official' : user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email || '').slice(0, 2)}•••`;
    const post = await dataAccess.socialPost.create({ authorId: getId(user), authorLabel, content, hashtags: extractHashtags(content), imageUrl, isOfficialAi: false, source: 'user', status: moderation.status, moderationReason: moderation.matchedWord ? 'banned_word' : '' });
    await realtimeService.publish('social_post_created', { postId: getId(post), status: post.status }, { scope: 'user' });
    res.status(201).json({ success: true, message: moderation.allowed ? 'تم نشر المنشور' : 'تم حجب المنشور تلقائياً لمخالفته قواعد الجدار', post: toClientPost(post) });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: 'رابط الصورة يجب أن يكون HTTPS من ImgBB فقط' });
    console.error('Social feed create error:', error.message);
    res.status(500).json({ error: 'تعذر نشر المحتوى حالياً' });
  }
}

async function toggleLike(req, res) {
  try {
    const post = await visiblePost(req.params.postId);
    if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
    const likedBy = Array.isArray(post.likedBy) ? post.likedBy.map(String) : [];
    const index = likedBy.indexOf(String(req.user.id));
    if (index >= 0) likedBy.splice(index, 1); else likedBy.push(String(req.user.id));
    await dataAccess.socialPost.updateOne({ id: getId(post), status: 'visible' }, { likedBy, likeCount: likedBy.length });
    res.json({ success: true, liked: index < 0, likeCount: likedBy.length });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث الإعجاب' }); }
}

async function listLikes(req, res) {
  try {
    const post = await visiblePost(req.params.postId);
    if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
    const users = post.likedBy?.length ? await dataAccess.user.find({ id: { $in: post.likedBy }, isBanned: false }, { limit: 100 }) : [];
    res.json({ success: true, users: users.map(user => ({ id: getId(user), label: user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email || '').slice(0, 2)}•••` })) });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل قائمة الإعجابات' }); }
}

async function toggleSave(req, res) {
  try {
    const post = await visiblePost(req.params.postId);
    if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
    const savedBy = Array.isArray(post.savedBy) ? post.savedBy.map(String) : [];
    const index = savedBy.indexOf(String(req.user.id));
    if (index >= 0) savedBy.splice(index, 1); else savedBy.push(String(req.user.id));
    await dataAccess.socialPost.updateOne({ id: getId(post), status: 'visible' }, { savedBy });
    res.json({ success: true, saved: index < 0 });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث المحفوظات' }); }
}

async function sharePost(req, res) {
  try {
    const post = await visiblePost(req.params.postId);
    if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
    const shareCount = Number(post.shareCount || 0) + 1;
    await dataAccess.socialPost.updateOne({ id: getId(post), status: 'visible' }, { shareCount });
    res.json({ success: true, shareCount });
  } catch (error) { res.status(500).json({ error: 'تعذر تسجيل المشاركة' }); }
}

async function togglePin(req, res) {
  try {
    const post = await dataAccess.socialPost.findOne({ id: req.params.postId, authorId: req.user.id, status: 'visible' });
    if (!post) return res.status(404).json({ error: 'لا يمكنك تثبيت هذا المنشور' });
    if (!post.isPinned) await dataAccess.socialPost.updateMany({ authorId: req.user.id, isPinned: true }, { isPinned: false });
    const isPinned = !post.isPinned;
    await dataAccess.socialPost.updateOne({ id: getId(post), status: 'visible' }, { isPinned });
    res.json({ success: true, isPinned });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث المنشور المثبت' }); }
}

async function addComment(req, res) {
  try {
    const content = String(req.body?.content || '').trim();
    if (content.length < 2 || content.length > 300) return res.status(400).json({ error: 'يجب أن يتراوح التعليق بين حرفين و300 حرف' });
    const moderation = moderateText(content);
    const user = await dataAccess.user.findById(req.user.id);
    const post = await visiblePost(req.params.postId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
    const comment = { authorId: getId(user), authorLabel: user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email || '').slice(0, 2)}•••`, content, status: moderation.status, moderationReason: moderation.matchedWord ? 'banned_word' : '', createdAt: new Date().toISOString() };
    const comments = Array.isArray(post.comments) ? post.comments : [];
    comments.push(comment);
    await dataAccess.socialPost.updateOne({ id: getId(post), status: 'visible' }, { comments });
    const responseComment = { ...comment };
    delete responseComment.authorId;
    res.status(201).json({ success: true, message: moderation.allowed ? 'تمت إضافة التعليق' : 'تم حجب التعليق تلقائياً', comment: responseComment });
  } catch (error) { res.status(500).json({ error: 'تعذر إضافة التعليق' }); }
}

async function updatePost(req, res) {
  try {
    const content = String(req.body?.content || '').trim();
    if (content.length < 2 || content.length > 500) return res.status(400).json({ error: 'نص المنشور غير صالح' });
    const moderation = moderateText(content);
    const post = await dataAccess.socialPost.findOne({ id: req.params.postId, authorId: req.user.id, status: { $in: ['visible', 'banned'] } });
    if (!post) return res.status(404).json({ error: 'لا يمكنك تعديل هذا المنشور' });
    const updated = await dataAccess.socialPost.updateOne({ id: getId(post) }, { content, hashtags: extractHashtags(content), status: moderation.status, moderationReason: moderation.matchedWord ? 'banned_word' : '' });
    res.json({ success: true, post: updated });
  } catch (error) { res.status(500).json({ error: 'تعذر تعديل المنشور' }); }
}

async function deletePost(req, res) {
  const post = await dataAccess.socialPost.findOne({ id: req.params.postId, authorId: req.user.id, status: { $ne: 'removed' } });
  if (!post) return res.status(404).json({ error: 'لا يمكنك حذف هذا المنشور' });
  await dataAccess.socialPost.updateOne({ id: getId(post) }, { status: 'removed' });
  res.json({ success: true, message: 'تم حذف المنشور' });
}

async function reportPost(req, res) {
  try {
    const post = await visiblePost(req.params.postId);
    if (!post) return res.status(400).json({ error: 'المنشور غير موجود أو لم يعد متاحاً' });
    const reportedBy = Array.isArray(post.reportedBy) ? post.reportedBy.map(String) : [];
    if (reportedBy.includes(String(req.user.id))) return res.status(400).json({ error: 'تم الإبلاغ عن المنشور مسبقاً' });
    reportedBy.push(String(req.user.id));
    await dataAccess.socialPost.updateOne({ id: getId(post), status: 'visible' }, { reportedBy, reportCount: reportedBy.length, status: reportedBy.length >= 3 ? 'hidden' : 'visible' });
    res.json({ success: true, message: 'تم استلام البلاغ ومراجعة المنشور' });
  } catch (error) { res.status(500).json({ error: 'تعذر تسجيل البلاغ' }); }
}

async function uploadImage(req, res) {
  try {
    const image = String(req.body?.image || '').trim();
    if (!process.env.IMGBB_API_KEY) return res.status(503).json({ error: 'رفع الصور غير مهيأ حالياً' });
    if (!/^data:image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif|avif);base64,[A-Za-z0-9+/=]+$/i.test(image) || image.length > MAX_IMAGE_DATA_LENGTH) return res.status(400).json({ error: 'الصورة يجب أن تكون JPG أو PNG أو WebP أو أي صورة مدعومة وألا تتجاوز 2 ميجابايت' });
    const form = new FormData();
    form.append('image', image.split(',')[1]);
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok || !data.success || !isAllowedImageUrl(data.data?.url)) return res.status(502).json({ error: 'تعذر رفع الصورة إلى ImgBB' });
    res.json({ success: true, image_url: data.data.url });
  } catch (error) { res.status(502).json({ error: 'تعذر الاتصال بخدمة الصور' }); }
}

async function listReportedPosts(req, res) {
  const posts = await dataAccess.socialPost.find({}, { sort: { reportCount: -1, createdAt: -1 }, limit: 100 });
  res.json({ success: true, posts: posts.filter(post => Number(post.reportCount || 0) > 0 || post.status === 'banned').map(post => { delete post.reportedBy; return toClientPost(post); }) });
}

async function moderatePost(req, res) {
  const status = ['visible', 'hidden', 'removed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'حالة moderation غير صالحة' });
  const post = await dataAccess.socialPost.findOne({ id: req.params.postId });
  if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
  const updated = await dataAccess.socialPost.updateOne({ id: getId(post) }, { status });
  res.json({ success: true, post: updated });
}

module.exports = { listPosts, createPost, reportPost, uploadImage, listReportedPosts, moderatePost, toggleLike, listLikes, toggleSave, sharePost, togglePin, addComment, updatePost, deletePost };
