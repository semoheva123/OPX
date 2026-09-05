const mongoose = require('mongoose');
const securityEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  email: { type: String, trim: true, lowercase: true },
  event: { type: String, enum: ['login_success', 'login_failed', 'new_device', 'email_verified', 'session_revoked', 'withdrawal_risk'], required: true },
  ip: { type: String, trim: true },
  userAgent: { type: String, trim: true },
  metadata: { type: Object, default: {} }
}, { timestamps: true });
securityEventSchema.index({ createdAt: -1 });
module.exports = mongoose.model('SecurityEvent', securityEventSchema);
