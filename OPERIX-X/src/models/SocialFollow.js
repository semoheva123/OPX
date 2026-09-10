const mongoose = require('mongoose');

const socialFollowSchema = new mongoose.Schema({
  followerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  followingId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
}, { timestamps: true });

socialFollowSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
socialFollowSchema.index({ followingId: 1, createdAt: -1 });

module.exports = mongoose.model('SocialFollow', socialFollowSchema);
