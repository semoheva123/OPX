const FinancialLedger = require('../models/FinancialLedger');
const { maybeMirrorDocument } = require('./supabaseWriteMirror');

async function recordLedgerEntry({ userId, type, amount, feeAmount = 0, netAmount = 0, currency = 'USDT', status = 'approved', source = 'system', referenceId = null, notes = '', metadata = {}, balanceBefore = 0, balanceAfter = 0 }, session = null) {
  const payload = {
    userId,
    type,
    amount: Number(amount || 0),
    feeAmount: Number(feeAmount || 0),
    netAmount: Number(netAmount || 0),
    currency,
    status,
    source,
    referenceId: referenceId || null,
    notes,
    metadata: metadata || {},
    balanceBefore: Number(balanceBefore || 0),
    balanceAfter: Number(balanceAfter || 0)
  };

  if (session) {
    return FinancialLedger.create([payload], { session }).then(async ([entry]) => {
      await maybeMirrorDocument('FinancialLedger', entry).catch(() => {});
      return entry;
    });
  }

  const entry = await FinancialLedger.create(payload);
  await maybeMirrorDocument('FinancialLedger', entry).catch(() => {});
  return entry;
}

module.exports = { recordLedgerEntry };
