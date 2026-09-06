const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'reward', 'staking_reward', 'referral_commission', 'upgrade_deduction', 'token_burn', 'vault_lock', 'vault_release', 'vault_early_release', 'vault_penalty', 'admin_adjustment'], required: true },
  amount: { type: Number, required: true },
  grossAmount: { type: Number, default: 0, min: 0 },
  usdtAmount: { type: Number, default: 0, min: 0 },
  opxAmount: { type: Number, default: 0, min: 0 },
  feeAmount: { type: Number, default: 0 },
  netAmount: { type: Number, default: 0 },
  walletAddress: { type: String, required: true, trim: true },
  txHash: { type: String, trim: true },
  idempotencyKey: { type: String, trim: true, index: true },
  network: { type: String, enum: ['TRC20', 'BEP20'] },
  riskScore: { type: Number, min: 0, max: 100, default: 0 },
  riskLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  riskFlags: { type: [String], default: [] },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

transactionSchema.index(
  { type: 1, network: 1, txHash: 1 },
  { unique: true, partialFilterExpression: { type: 'deposit', txHash: { $type: 'string' } } }
);

module.exports = mongoose.model('Transaction', transactionSchema);
