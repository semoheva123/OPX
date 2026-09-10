const mongoose = require('mongoose');

const gameSettingSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'default' },
  spinMin: { type: Number, default: 1, min: 0 },
  spinMax: { type: Number, default: 10, min: 0 },
  boxMin: { type: Number, default: 5, min: 0 },
  boxMax: { type: Number, default: 25, min: 0 },
  dailyGameRewardCap: { type: Number, default: 100, min: 0 }
  , referralsPerCycle: { type: Number, default: 25, min: 1, max: 100000 }
}, { timestamps: true });

module.exports = mongoose.model('GameSetting', gameSettingSchema);
