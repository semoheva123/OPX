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
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const requestedStatus = ['open', 'in_progress', 'resolved'].includes(String(req.query.status)) ? String(req.query.status) : '';
    const search = String(req.query.search || '').trim().slice(0, 120).toLowerCase();
    const baseQuery = requestedStatus ? { status: requestedStatus } : { status: { $ne: 'closed' } };

    const counts = await Promise.all(['open', 'in_progress', 'resolved'].map(status =>
      dataAccess.supportTicket.countDocuments({ status }).catch(() => 0)
    ));
    const countsPayload = { open: Number(counts[0] || 0), in_progress: Number(counts[1] || 0), resolved: Number(counts[2] || 0) };
    countsPayload.active = countsPayload.open + countsPayload.in_progress;
    countsPayload.all = countsPayload.active + countsPayload.resolved;

    if (search) {
      const candidates = await dataAccess.supportTicket.find(baseQuery, { sort: { updatedAt: -1 }, limit: 300 });
      const matched = candidates.filter(ticket => {
        const haystack = `${ticket.subject || ''} ${ticket.message || ''} ${ticket.userId?.email || ''} ${ticket.adminReply || ''}`.toLowerCase();
        return haystack.includes(search);
      });
      const total = matched.length;
      return res.json({
        success: true,
        tickets: matched.slice((page - 1) * limit, page * limit),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        counts: countsPayload,
        truncationNotice: candidates.length >= 300 ? 'تم البحث في أحدث 300 تذكرة فقط' : null
      });
    }

    const [tickets, total] = await Promise.all([
      dataAccess.supportTicket.find(baseQuery, { sort: { updatedAt: -1 }, limit, skip: (page - 1) * limit }),
      dataAccess.supportTicket.countDocuments(baseQuery).catch(() => 0)
    ]);
    res.json({
      success: true,
      tickets,
      page,
      limit,
      total: Number(total || 0),
      totalPages: Math.max(1, Math.ceil(Number(total || 0) / limit)),
      counts: countsPayload
    });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل تذاكر الدعم' }); }
}

async function updateAdmin(req, res) {
  try {
    const ticket = await dataAccess.supportTicket.findOne({ id: req.params.id });
    if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة' });

    const status = ['open', 'in_progress', 'resolved', 'closed'].includes(req.body.status) ? req.body.status : ticket.status;
    const reply = String(req.body.reply || '').trim();
    const update = { status };
    const hasReply = Boolean(reply);
    const statusChanged = status !== ticket.status;

    if (hasReply) {
      update.adminReply = reply;
      update.repliedAt = new Date();
    }

    if (hasReply || statusChanged) {
      const notificationBody = hasReply ? reply : `تم تحديث تذكرة الدعم إلى ${status}`;
      const notification = await dataAccess.notification.create({
        userId: ticket.userId,
        title: 'تم تحديث تذكرة الدعم',
        body: notificationBody,
        type: 'support'
      });
      realtimeService.emit(
        'notification_created',
        { notificationId: notification.id || notification._id, title: notification.title, type: notification.type },
        { userId: ticket.userId }
      );
    }

    const saved = await dataAccess.supportTicket.updateOne({ id: req.params.id }, { $set: update });
    res.json({ success: true, ticket: saved || ticket });
  } catch (error) {
    res.status(500).json({ error: 'تعذر تحديث التذكرة' });
  }
}

module.exports = { list, create, reply, listAdmin, updateAdmin };
