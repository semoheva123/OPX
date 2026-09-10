const mongoose = require('mongoose');

const stakingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 0 },
  durationDays: { type: Number, enum: [7, 15, 30], required: true },
  profitRate: { type: Number, required: true },
  expectedProfit: { type: Number, required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'completed', 'claimed'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('Staking', stakingSchema);
