const mongoose = require('mongoose');
const broadcastSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  body: { type: String, required: true, trim: true, maxlength: 500 },
  audienceType: { type: String, enum: ['all', 'active', 'tier', 'role'], default: 'all' },
  audienceValue: { type: String, default: '' },
  scheduledAt: { type: Date, default: null },
  status: { type: String, enum: ['scheduled', 'sending', 'sent', 'failed'], default: 'scheduled', index: true },
  recipientCount: { type: Number, default: 0 },
  internalSent: { type: Number, default: 0 },
  pushSent: { type: Number, default: 0 },
  pushFailed: { type: Number, default: 0 },
  readCount: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sentAt: { type: Date, default: null }
}, { timestamps: true });
broadcastSchema.index({ status: 1, scheduledAt: 1 });
module.exports = mongoose.model('Broadcast', broadcastSchema);
