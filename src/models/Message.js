const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  body: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['visible', 'banned'], default: 'visible', index: true },
  moderationReason: { type: String, trim: true, maxlength: 80, default: '' },
  readAt: { type: Date, default: null }
}, { timestamps: true });

messageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, senderId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);