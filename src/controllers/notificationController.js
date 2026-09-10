const Notification = require('../models/Notification');

async function list(req, res) {
  try {
    const notifications = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
    const unread = await Notification.countDocuments({ userId: req.user.id, readAt: null });
    res.json({ success: true, notifications, unread });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل الإشعارات' }); }
}

async function markRead(req, res) {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user.id }, { readAt: new Date() });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث الإشعار' }); }
}

async function markAllRead(req, res) {
  try {
    await Notification.updateMany({ userId: req.user.id, readAt: null }, { readAt: new Date() });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث الإشعارات' }); }
}

module.exports = { list, markRead, markAllRead };
