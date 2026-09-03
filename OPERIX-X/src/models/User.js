const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String, default: null, select: false },
  emailVerificationExpire: { type: Date, default: null, select: false },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin', 'financial_admin', 'support_admin', 'monitor'], default: 'user' },
  tierCode: { type: String, default: 'A1', uppercase: true, trim: true },
  assetWallet: { type: Number, default: 0 },
  todayCompletedTasks: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, uppercase: true, trim: true },
  referredBy: { type: String, default: null, uppercase: true, trim: true },
  walletAddress: { type: String, default: '', trim: true },
  isBanned: { type: Boolean, default: false },
  wallet: {
    balance: { type: Number, default: 0, min: 0 },
    depositBalance: { type: Number, default: 0, min: 0 },
    profitBalance: { type: Number, default: 0, min: 0 },
    totalDeposits: { type: Number, default: 0, min: 0 },
    totalWithdrawn: { type: Number, default: 0, min: 0 }
  },
  resetOTP: { type: String, default: null, select: false },
  resetOTPExpire: { type: Date, default: null },
  resetOTPAttempts: { type: Number, default: 0, min: 0, max: 5 },
  twoFactorCode: { type: String, default: null },
  twoFactorExpire: { type: Date, default: null },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, default: null, select: false },
  adminTwoFactorEnabled: { type: Boolean, default: false },
  adminTwoFactorSecret: { type: String, default: null, select: false },
  adminInviteToken: { type: String, default: null, select: false },
  adminInviteExpire: { type: Date, default: null, select: false },
  adminInviteUsed: { type: Boolean, default: false },
  termsAcceptedAt: { type: Date, default: null },
  gameCyclesGranted: { type: Number, default: 0, min: 0 },
  wheelCredits: { type: Number, default: 0, min: 0 },
  mysteryBoxCredits: { type: Number, default: 0, min: 0 },
  profileImage: { type: String, default: '' },
  pushSubscription: { type: Object, default: null },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
