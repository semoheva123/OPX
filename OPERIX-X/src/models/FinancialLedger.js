const mongoose = require('mongoose');
const { maybeMirrorDocument } = require('../services/supabaseWriteMirror');

const financialLedgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: ['deposit', 'withdraw', 'reward', 'staking_reward', 'referral_commission', 'upgrade_deduction', 'token_burn', 'vault_lock', 'vault_release', 'vault_early_release', 'vault_penalty', 'admin_adjustment'],
    required: true,
    index: true
  },
  currency: { type: String, enum: ['USDT', 'OPX'], default: 'USDT', index: true },
  amount: { type: Number, required: true, min: 0 },
  feeAmount: { type: Number, default: 0, min: 0 },
  netAmount: { type: Number, default: 0, min: 0 },
  balanceBefore: { type: Number, default: 0 },
  balanceAfter: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
  source: { type: String, default: 'system', trim: true },
  referenceId: { type: String, default: null, trim: true, index: true },
  notes: { type: String, default: '', trim: true },
  metadata: { type: Object, default: {} }
}, { timestamps: true });

financialLedgerSchema.index({ userId: 1, type: 1, referenceId: 1 }, { unique: false });

financialLedgerSchema.post('save', async function(doc) {
  try {
    await maybeMirrorDocument('FinancialLedger', doc);
  } catch (error) {
    console.warn('Supabase ledger mirror skipped:', error.message);
  }
});

module.exports = mongoose.model('FinancialLedger', financialLedgerSchema);
