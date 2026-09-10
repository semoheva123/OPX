const mongoose = require('mongoose');
const { maybeMirrorDocument } = require('../services/supabaseWriteMirror');

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scope: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  jti: { type: String, required: true, unique: true, index: true },
  userAgent: { type: String, default: 'unknown', trim: true },
  ip: { type: String, default: 'unknown', trim: true },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

sessionSchema.post('save', async function(doc) {
  try {
    await maybeMirrorDocument('Session', doc);
  } catch (error) {
    console.warn('Supabase session mirror skipped:', error.message);
  }
});

module.exports = mongoose.model('Session', sessionSchema);