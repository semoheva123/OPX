const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { moderateText } = require('../services/socialSafetyBot');
const realtimeService = require('../services/realtimeService');

function validId(value) { return mongoose.Types.ObjectId.isValid(value); }

function labelFor(user) {
  return user.referralCode ? `عضو ${user.referralCode}` : `عضو ${String(user.email).slice(0, 2)}•••`;
}

function safeMessage(message) {
  return { _id: message._id, senderId: message.senderId, recipientId: message.recipientId, body: message.status === 'visible' ? message.body : 'تم حجب هذه الرسالة تلقائياً', status: message.status, readAt: message.readAt, createdAt: message.createdAt };
}

async function listConversations(req, res) {
  try {
    const userId = String(req.user.id);
    const messages = await Message.find({ $or: [{ senderId: userId }, { recipientId: userId }] }).sort({ createdAt: -1 }).limit(500).lean();
    const conversations = new Map();
    for (const message of messages) {
      const otherId = String(message.senderId) === userId ? String(message.recipientId) : String(message.senderId);
      if (!conversations.has(otherId)) conversations.set(otherId, { otherId, lastMessage: safeMessage(message), unread: 0 });
      if (String(message.recipientId) === userId && !message.readAt && message.status === 'visible') conversations.get(otherId).unread += 1;
    }
    const ids = [...conversations.keys()];
    const users = await User.find({ _id: { $in: ids }, isBanned: false }).select('email referralCode profileImage').lean();
    const byId = new Map(users.map(user => [String(user._id), user]));
    res.json({ success: true, conversations: ids.map(id => ({ ...conversations.get(id), user: byId.get(id) ? { _id: byId.get(id)._id, label: labelFor(byId.get(id)), profileImage: byId.get(id).profileImage || '' } : null })).filter(item => item.user) });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل المحادثات الخاصة' }); }
}

async function getThread(req, res) {
  try {
    if (!validId(req.params.userId) || String(req.params.userId) === String(req.user.id)) return res.status(400).json({ error: 'المستخدم المستهدف غير صالح' });
    const user = await User.findOne({ _id: req.params.userId, isBanned: false }).select('email referralCode profileImage').lean();
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const filter = { $or: [{ senderId: req.user.id, recipientId: user._id }, { senderId: user._id, recipientId: req.user.id }] };
    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    await Message.updateMany({ senderId: user._id, recipientId: req.user.id, readAt: null }, { readAt: new Date() });
    res.json({ success: true, user: { _id: user._id, label: labelFor(user), profileImage: user.profileImage || '' }, messages: messages.reverse().map(safeMessage) });
  } catch (error) { res.status(500).json({ error: 'تعذر تحميل المحادثة' }); }
}

async function sendMessage(req, res) {
  try {
    if (!validId(req.params.userId) || String(req.params.userId) === String(req.user.id)) return res.status(400).json({ error: 'لا يمكنك مراسلة هذا المستخدم' });
    const body = String(req.body?.body || '').trim();
    if (body.length < 1 || body.length > 500) return res.status(400).json({ error: 'يجب أن تتراوح الرسالة بين حرف واحد و500 حرف' });
    const recipient = await User.findOne({ _id: req.params.userId, isBanned: false }).select('email referralCode');
    if (!recipient) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const moderation = moderateText(body);
    const message = await Message.create({ senderId: req.user.id, recipientId: recipient._id, body, status: moderation.status, moderationReason: moderation.matchedWord ? 'banned_word' : '' });
    const notification = await Notification.create({ userId: recipient._id, title: 'رسالة خاصة جديدة', body: moderation.allowed ? 'لديك رسالة جديدة من أحد أعضاء المجتمع.' : 'لديك رسالة جديدة قيد المراجعة.', type: 'system' });
    realtimeService.emit('notification_created', { notificationId: notification._id, title: notification.title, type: notification.type }, { userId: recipient._id });
    realtimeService.emit('private_message_created', { message: safeMessage(message) }, { userId: recipient._id });
    res.status(201).json({ success: true, message: safeMessage(message) });
  } catch (error) { res.status(500).json({ error: 'تعذر إرسال الرسالة' }); }
}

module.exports = { listConversations, getThread, sendMessage };