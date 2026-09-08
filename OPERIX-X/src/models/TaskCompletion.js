const mongoose = require('mongoose');

const taskCompletionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExternalTask', required: true },
  platform: { type: String, enum: ['zealy'], required: true },
  externalEventId: { type: String, required: true, trim: true },
  externalUserId: { type: String, default: '', trim: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  rewardUsdt: { type: Number, default: 0, min: 0 },
  rewardOpx: { type: Number, default: 0, min: 0 },
  verifiedAt: { type: Date, default: null }
}, { timestamps: true });

taskCompletionSchema.index({ platform: 1, externalEventId: 1 }, { unique: true });
taskCompletionSchema.index({ userId: 1, taskId: 1 }, { unique: true });

module.exports = mongoose.model('TaskCompletion', taskCompletionSchema);