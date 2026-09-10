const Notification = require('../models/Notification');
const dataAccess = require('../services/dataAccess');

async function list(req, res) {
  try {
    const notifications = dataAccess.isSupabaseRuntime()
      ? await dataAccess.notification.find({ userId: req.user.id }, { sort: { createdAt: -1 }, limit: 50 })
      : await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
    const unread = dataAccess.isSupabaseRuntime()
      ? await dataAccess.notification.countDocuments({ userId: req.user.id, readAt: null })
      : await Notification.countDocuments({ userId: req.user.id, readAt: null });
    res.json({ success: true, notifications, unread });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل الإشعارات' }); }
}

async function markRead(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) await dataAccess.notification.updateOne({ id: req.params.id, userId: req.user.id }, { $set: { readAt: new Date() } });
    else await Notification.updateOne({ _id: req.params.id, userId: req.user.id }, { readAt: new Date() });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث الإشعار' }); }
}

async function markAllRead(req, res) {
  try {
    if (dataAccess.isSupabaseRuntime()) await dataAccess.notification.updateMany({ userId: req.user.id, readAt: null }, { $set: { readAt: new Date() } });
    else await Notification.updateMany({ userId: req.user.id, readAt: null }, { readAt: new Date() });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث الإشعارات' }); }
}

module.exports = { list, markRead, markAllRead };
