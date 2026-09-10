const mongoose = require('mongoose');

const vipLevelSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  tasks: { type: Number, required: true, min: 1 },
  dailyProfit: { type: Number, required: true, min: 0 },
  monthlyProfit: { type: Number, required: true, min: 0 },
  yearlyProfit: { type: Number, required: true, min: 0 },
  badgeColor: { type: String, enum: [
    'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400',
    'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400',
    'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400',
    'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400',
    'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400'
  ], default: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' }
}, { timestamps: true });

module.exports = mongoose.model('VipLevel', vipLevelSchema);
