const SocialPost = require('../models/SocialPost');
const User = require('../models/User');
const { moderateText } = require('../services/socialSafetyBot');

const MAX_IMAGE_DATA_LENGTH = 900000;
const allowedImageHosts = new Set(['ibb.co', 'www.ibb.co', 'i.ibb.co', 'imgbb.com', 'www.imgbb.com']);

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

async function listPosts(req, res) {
  try {
    const page = Math.min(Math.max(Number.parseInt(req.query.page, 10) || 1, 1), 20);
    const limit = 15;
    const posts = await SocialPost.find({ status: 'visible' })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-reportedBy')
      .lean();
    res.json({ success: true, posts, page, hasMore: posts.length === limit });
  } catch (error) {
    res.status(500).json({ error: 'تعذر تحميل جدار التواصل حالياً' });
  }
}

async function createPost(req, res) {
  try {
    const content = String(req.body?.content || '').trim();
    if (content.length < 2 || content.length > 500) return res.status(400).json({ error: 'يجب أن يتراوح المنشور بين حرفين و500 حرف' });
    const moderation = moderateText(content);
    const image_url = normalizeImageUrl(req.body?.image_url);
    const recentPost = await SocialPost.exists({ authorId: req.user.id, createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } });
    if (recentPost) return res.status(429).json({ error: 'انتظر خمس دقائق قبل نشر منشور جديد' });
    const user = await User.findById(req.user.id).select('email referralCode');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const authorLabel = user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email).slice(0, 2)}•••`;
    const post = await SocialPost.create({ authorId: user._id, authorLabel, content, image_url, isOfficialAi: false, source: 'user', status: moderation.status, moderationReason: moderation.matchedWord ? 'banned_word' : '' });
    res.status(201).json({ success: true, message: moderation.allowed ? 'تم نشر المنشور' : 'تم حجب المنشور تلقائياً لمخالفته قواعد الجدار', post: post.toObject() });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: 'رابط الصورة يجب أن يكون HTTPS من ImgBB فقط' });
    res.status(500).json({ error: 'تعذر نشر المحتوى حالياً' });
  }
}

async function reportPost(req, res) {
  try {
    const post = await SocialPost.findOneAndUpdate(
      { _id: req.params.postId, status: 'visible', reportedBy: { $ne: req.user.id } },
      { $addToSet: { reportedBy: req.user.id }, $inc: { reportCount: 1 } },
      { new: true }
    );
    if (!post) return res.status(400).json({ error: 'تم الإبلاغ عن المنشور مسبقاً أو لم يعد متاحاً' });
    if (post.reportCount >= 3) {
      post.status = 'hidden';
      await post.save();
    }
    res.json({ success: true, message: 'تم استلام البلاغ ومراجعة المنشور' });
  } catch (error) {
    res.status(500).json({ error: 'تعذر تسجيل البلاغ' });
  }
}

async function uploadImage(req, res) {
  try {
    const image = String(req.body?.image || '').trim();
    if (!process.env.IMGBB_API_KEY) return res.status(503).json({ error: 'رفع الصور غير مهيأ حالياً' });
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(image) || image.length > MAX_IMAGE_DATA_LENGTH) {
      return res.status(400).json({ error: 'الصورة يجب أن تكون JPG أو PNG أو WebP وألا تتجاوز 650 كيلوبايت' });
    }
    const form = new FormData();
    form.append('image', image.split(',')[1]);
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok || !data.success || !isAllowedImageUrl(data.data?.url)) return res.status(502).json({ error: 'تعذر رفع الصورة إلى ImgBB' });
    res.json({ success: true, image_url: data.data.url });
  } catch (error) {
    res.status(502).json({ error: 'تعذر الاتصال بخدمة الصور' });
  }
}

async function listReportedPosts(req, res) {
  const posts = await SocialPost.find({ $or: [{ reportCount: { $gt: 0 } }, { status: 'banned' }] }).sort({ reportCount: -1, createdAt: -1 }).limit(100).select('-reportedBy').lean();
  res.json({ success: true, posts });
}

async function moderatePost(req, res) {
  const status = ['visible', 'hidden', 'removed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'حالة moderation غير صالحة' });
  const post = await SocialPost.findByIdAndUpdate(req.params.postId, { status }, { new: true }).select('-reportedBy');
  if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
  res.json({ success: true, post });
}

module.exports = { listPosts, createPost, reportPost, uploadImage, listReportedPosts, moderatePost };