const SupportTicket = require('../models/SupportTicket');
const Notification = require('../models/Notification');
const realtimeService = require('../services/realtimeService');
const dataAccess = require('../services/dataAccess');

async function list(req, res) {
  try {
    const tickets = dataAccess.isSupabaseRuntime() ? await dataAccess.supportTicket.find({ userId: req.user.id }, { sort: { updatedAt: -1 }, limit: 50 }) : await SupportTicket.find({ userId: req.user.id }).sort({ updatedAt: -1 }).limit(50).lean();
    res.json({ success: true, tickets });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تذاكر الدعم' }); }
}

async function create(req, res) {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    if (subject.length < 3 || message.length < 10) return res.status(400).json({ error: 'يرجى إدخال عنوان ورسالة واضحين' });
    const ticket = dataAccess.isSupabaseRuntime() ? await dataAccess.supportTicket.create({ userId: req.user.id, subject, message }) : await SupportTicket.create({ userId: req.user.id, subject, message });
    res.status(201).json({ success: true, ticket, message: 'تم إنشاء تذكرة الدعم' });
  } catch (error) { res.status(500).json({ error: 'تعذر إنشاء تذكرة الدعم' }); }
}

async function reply(req, res) {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, userId: req.user.id });
    if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة' });
    const message = String(req.body.message || '').trim();
    if (message.length < 2) return res.status(400).json({ error: 'الرسالة قصيرة جدًا' });
    ticket.message = `${ticket.message}\n\nرد المستخدم: ${message}`.slice(-2000);
    ticket.status = 'open';
    await ticket.save();
    res.json({ success: true, ticket });
  } catch (error) { res.status(500).json({ error: 'تعذر إرسال الرد' }); }
}

async function listAdmin(req, res) {
  try {
    const tickets = await SupportTicket.find({ status: { $ne: 'closed' } }).populate('userId', 'email').sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ success: true, tickets });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تذاكر الدعم' }); }
}

async function updateAdmin(req, res) {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة' });
    const status = ['open', 'in_progress', 'resolved', 'closed'].includes(req.body.status) ? req.body.status : ticket.status;
    const reply = String(req.body.reply || '').trim();
    ticket.status = status;
    if (reply) {
      ticket.adminReply = reply; ticket.repliedAt = new Date();
      const notification = await Notification.create({ userId: ticket.userId, title: 'تم تحديث تذكرة الدعم', body: reply, type: 'support' });
      realtimeService.emit('notification_created', { notificationId: notification._id, title: notification.title, type: notification.type }, { userId: ticket.userId });
    }
    await ticket.save();
    res.json({ success: true, ticket });
  } catch (error) { res.status(500).json({ error: 'تعذر تحديث التذكرة' }); }
}

module.exports = { list, create, reply, listAdmin, updateAdmin };
