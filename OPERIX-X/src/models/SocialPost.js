const mongoose = require('mongoose');

const socialPostSchema = new mongoose.Schema({
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  authorLabel: { type: String, required: true, trim: true, maxlength: 40, default: 'OPERIX AI' },
  content: { type: String, required: true, trim: true, maxlength: 500 },
  image_url: { type: String, trim: true, maxlength: 500, default: '' },
  isOfficialAi: { type: Boolean, default: false, index: true },
  source: { type: String, enum: ['user', 'ai_generated'], default: 'user', index: true },
  status: { type: String, enum: ['visible', 'hidden', 'banned', 'removed'], default: 'visible', index: true },
  moderationReason: { type: String, trim: true, maxlength: 80, default: '' },
  reportCount: { type: Number, default: 0, min: 0 },
  reportedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  likeCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

socialPostSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SocialPost', socialPostSchema);