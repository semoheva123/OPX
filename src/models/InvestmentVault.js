const mongoose = require('mongoose');

const investmentVaultSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  durationDays: { type: Number, enum: [90, 180, 365], required: true },
  expectedReturnRate: { type: Number, default: 0, min: 0, max: 100 },
  expectedProfit: { type: Number, default: 0, min: 0 },
  startDate: { type: Date, default: Date.now },
  maturityDate: { type: Date, required: true },
  incentiveAmount: { type: Number, default: 0, min: 0 },
  incentiveStatus: { type: String, enum: ['pending', 'approved', 'none'], default: 'pending' },
  penaltyAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['active', 'matured', 'claimed', 'emergency_released'], default: 'active' }
}, { timestamps: true, collection: 'investment_vault' });

investmentVaultSchema.index({ userId: 1, status: 1, maturityDate: 1 });

module.exports = mongoose.model('InvestmentVault', investmentVaultSchema);