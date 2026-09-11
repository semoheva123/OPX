const dataAccess = require('../services/dataAccess');

async function list(req, res) {
  try {
    const notifications = await dataAccess.notification.find({ userId: req.user.id }, { sort: { createdAt: -1 }, limit: 50 });
    const unread = await dataAccess.notification.countDocuments({ userId: req.user.id, readAt: null });
    res.json({ success: true, notifications, unread });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل الإشعارات' }); }
}

async function markRead(req, res) {
  try {
    await dataAccess.notification.updateOne({ id: req.params.id, userId: req.user.id }, { $set: { readAt: new Date() } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث الإشعار' }); }
}

async function markAllRead(req, res) {
  try {
    await dataAccess.notification.updateMany({ userId: req.user.id, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث الإشعارات' }); }
}

module.exports = { list, markRead, markAllRead };
