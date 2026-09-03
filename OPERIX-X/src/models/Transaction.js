const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'reward', 'staking_reward', 'referral_commission', 'upgrade_deduction'], required: true },
  amount: { type: Number, required: true },
  walletAddress: { type: String, required: true, trim: true },
  txHash: { type: String, trim: true },
  network: { type: String, enum: ['TRC20', 'BEP20'] },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

transactionSchema.index(
  { type: 1, network: 1, txHash: 1 },
  { unique: true, partialFilterExpression: { type: 'deposit', txHash: { $type: 'string' } } }
);

module.exports = mongoose.model('Transaction', transactionSchema);
