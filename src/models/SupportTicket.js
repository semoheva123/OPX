const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open', index: true },
  adminReply: { type: String, default: '', trim: true, maxlength: 3000 },
  repliedAt: { type: Date, default: null }
}, { timestamps: true });
supportTicketSchema.index({ userId: 1, updatedAt: -1 });
module.exports = mongoose.model('SupportTicket', supportTicketSchema);
