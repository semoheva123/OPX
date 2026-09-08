const mongoose = require('mongoose');

const externalTaskSchema = new mongoose.Schema({
  platform: { type: String, enum: ['zealy'], required: true },
  communitySubdomain: { type: String, required: true, trim: true, lowercase: true },
  externalId: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  category: { type: String, default: 'operations', trim: true },
  xp: { type: Number, default: 0, min: 0 },
  rewardUsdt: { type: Number, default: 0, min: 0 },
  minimumTier: { type: String, default: 'A1', uppercase: true, trim: true },
  url: { type: String, default: '', trim: true },
  active: { type: Boolean, default: true },
  syncedAt: { type: Date, default: null }
}, { timestamps: true });

externalTaskSchema.index({ platform: 1, externalId: 1 }, { unique: true });

module.exports = mongoose.model('ExternalTask', externalTaskSchema);