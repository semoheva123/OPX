const realtimeService = require('../services/realtimeService');
const dataAccess = require('../services/dataAccess');

async function list(req, res) {
  try {
    const tickets = await dataAccess.supportTicket.find({ userId: req.user.id }, { sort: { updatedAt: -1 }, limit: 50 });
    res.json({ success: true, tickets });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تذاكر الدعم' }); }
}

async function create(req, res) {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    if (subject.length < 3 || message.length < 10) return res.status(400).json({ error: 'يرجى إدخال عنوان ورسالة واضحةين' });
    const ticket = await dataAccess.supportTicket.create({ userId: req.user.id, subject, message });
    res.status(201).json({ success: true, ticket, message: 'تم إنشاء تذكرة الدعم' });
  } catch (error) { res.status(500).json({ error: 'تعذر إنشاء تذكرة الدعم' }); }
}

async function reply(req, res) {
  try {
    const ticket = await dataAccess.supportTicket.findOne({ id: req.params.id, userId: req.user.id });
    if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة' });
    const message = String(req.body.message || '').trim();
    if (message.length < 2) return res.status(400).json({ error: 'الرسالة قصيرة جدًا' });
    const nextMessage = `${ticket.message || ''}\n\nرد المستخدم: ${message}`.slice(-2000);
    const updated = await dataAccess.supportTicket.updateOne({ id: req.params.id, userId: req.user.id }, { $set: { message: nextMessage, status: 'open' } });
    res.json({ success: true, ticket: updated || ticket });
  } catch (error) { res.status(500).json({ error: 'تعذر إرسال الرد' }); }
}

async function listAdmin(req, res) {
  try {
    const tickets = await dataAccess.supportTicket.find({ status: { $ne: 'closed' } }, { sort: { updatedAt: -1 }, limit: 100 });
    res.json({ success: true, tickets });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تذاكر الدعم' }); }
}

async function updateAdmin(req, res) {
  try {
    const ticket = await dataAccess.supportTicket.findOne({ id: req.params.id });
    if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة' });
    const status = ['open', 'in_progress', 'resolved', 'closed'].includes(req.body.status) ? req.body.status : ticket.status;
    const reply = String(req.body.reply || '').trim();
    const update = { status };
    if (reply) {
      update.adminReply = reply;
      update.repliedAt = new Date();
      const notification = await dataAccess.notification.create({ userId: ticket.userId, title: 'تم تحديث تذكرة الدعم', body: reply, type: 'support' });
      realtimeService.emit('notification_created', { notificationId: notification.id || notification._id, title: notification.title, type: notification.type }, { userId: ticket.userId });
    }
    const saved = await dataAccess.supportTicket.updateOne({ id: req.params.id }, { $set: update });
    res.json({ success: true, ticket: saved || ticket });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث التذكرة' }); }
}

module.exports = { list, create, reply, listAdmin, updateAdmin };
