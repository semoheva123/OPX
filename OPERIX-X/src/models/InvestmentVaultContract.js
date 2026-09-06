const mongoose = require('mongoose');

const investmentVaultContractSchema = new mongoose.Schema({
  durationDays: { type: Number, enum: [90, 180, 365], required: true, unique: true },
  expectedReturnRate: { type: Number, required: true, min: 0, max: 100 },
  enabled: { type: Boolean, default: true },
  label: { type: String, default: '', trim: true, maxlength: 120 }
}, { timestamps: true, collection: 'investment_vault_contracts' });

module.exports = mongoose.model('InvestmentVaultContract', investmentVaultContractSchema);