const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  broadcastId: { type: mongoose.Schema.Types.ObjectId, ref: 'Broadcast', default: null, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  body: { type: String, required: true, trim: true, maxlength: 500 },
  type: { type: String, enum: ['system', 'transaction', 'security', 'support'], default: 'system' },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
notificationSchema.index({ userId: 1, createdAt: -1 });
module.exports = mongoose.model('Notification', notificationSchema);
