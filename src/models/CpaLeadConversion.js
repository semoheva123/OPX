const mongoose = require('mongoose');

const cpaLeadConversionSchema = new mongoose.Schema({
  leadId: { type: String, required: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  campaignId: { type: String, default: '', trim: true },
  eventKey: { type: String, default: '', trim: true },
  payoutUsd: { type: Number, required: true, min: 0 },
  creditedGross: { type: Number, required: true, min: 0 },
  usdtAmount: { type: Number, required: true, min: 0 },
  opxAmount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['credited', 'reversed'], default: 'credited' },
  creditedAt: { type: Date, default: Date.now },
  reversedAt: { type: Date, default: null }
}, { timestamps: true });

cpaLeadConversionSchema.index({ leadId: 1 }, { unique: true });

module.exports = mongoose.model('CpaLeadConversion', cpaLeadConversionSchema);