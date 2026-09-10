const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { getDatabaseMode } = require('../config/database');

async function resolveSupabaseUserIdFromMongoUser(mongoUserId, fallbackEmail) {
  const client = getSupabaseAdminClient();
  if (!client || (!mongoUserId && !fallbackEmail)) return null;

  let email = fallbackEmail;
  if (!email && mongoUserId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(mongoUserId).select('email').lean();
      email = user?.email || null;
    } catch (error) {
      console.warn('Unable to resolve Mongo user email for Supabase mirror:', error.message);
      return null;
    }
  }

  if (!email) return null;

  try {
    const { data, error } = await client.from('users').select('id').eq('email', String(email).trim().toLowerCase()).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return data?.id || null;
  } catch (error) {
    console.warn('Supabase user lookup failed during mirror resolution:', error.message);
    return null;
  }
}

function stableUuid(value) {
  const text = String(value ?? crypto.randomUUID());
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function getSupabaseAdminClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function shouldMirrorToSupabase() {
  const mode = getDatabaseMode();
  return ['supabase', 'hybrid'].includes(mode) && Boolean(getSupabaseAdminClient());
}

function safeNumber(value, fallback = 0) {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return {};
  const sanitized = { ...metadata };
  for (const key of Object.keys(sanitized)) {
    if (sanitized[key] === undefined) delete sanitized[key];
    if (typeof sanitized[key] === 'string' && sanitized[key].length > 5000) {
      sanitized[key] = sanitized[key].slice(0, 5000);
    }
  }
  return sanitized;
}

async function mapUserToSupabaseRow(doc) {
  const wallet = doc.wallet || {};
  const resolvedUserId = await resolveSupabaseUserIdFromMongoUser(doc._id || doc.id, doc.email || null);
  const userId = resolvedUserId || stableUuid(doc._id || doc.id || `user:${doc.email || crypto.randomUUID()}`);
  const userRow = {
    id: userId,
    email: doc.email || `legacy-${String(doc._id || crypto.randomUUID())}@migrated.local`,
    password_hash: doc.password || '',
    role: ['user', 'admin', 'financial_admin', 'support_admin', 'monitor'].includes(doc.role) ? doc.role : 'user',
    email_verified: Boolean(doc.emailVerified),
    is_banned: Boolean(doc.isBanned),
    tier_code: String(doc.tierCode || 'A1').toUpperCase().slice(0, 20),
    referral_code: doc.referralCode || null,
    referred_by: doc.referredBy || null,
    wallet_address: doc.walletAddress || '',
    kyc_status: ['not_started', 'pending', 'verified', 'rejected'].includes(doc.kycStatus) ? doc.kycStatus : 'not_started',
    two_factor_enabled: Boolean(doc.twoFactorEnabled),
    two_factor_secret: doc.twoFactorSecret || null,
    admin_two_factor_enabled: Boolean(doc.adminTwoFactorEnabled),
    admin_two_factor_secret: doc.adminTwoFactorSecret || null,
    asset_wallet: safeNumber(doc.assetWallet, 0),
    created_at: doc.createdAt || new Date(),
    updated_at: doc.updatedAt || doc.createdAt || new Date(),
    last_login_at: doc.lastLoginAt || null,
    metadata: normalizeMetadata({
      ...doc,
      _id: undefined,
      __v: undefined,
      password: undefined,
      wallet: undefined,
      twoFactorSecret: undefined,
      adminTwoFactorSecret: undefined,
      emailVerificationToken: undefined,
      emailVerificationExpire: undefined,
      resetOTP: undefined,
      resetOTPExpire: undefined,
      adminInviteToken: undefined,
      adminInviteExpire: undefined,
      id: undefined
    })
  };

  const walletRow = {
    id: stableUuid(`${userId}:wallet`),
    user_id: userId,
    balance: safeNumber(wallet.balance, 0),
    deposit_balance: safeNumber(wallet.depositBalance, 0),
    profit_balance: safeNumber(wallet.profitBalance, 0),
    total_deposits: safeNumber(wallet.totalDeposits, 0),
    total_withdrawn: safeNumber(wallet.totalWithdrawn, 0),
    usdt_balance: safeNumber(doc.USDT_balance, 0),
    opx_balance: safeNumber(doc.OPX_balance, 0),
    created_at: doc.createdAt || new Date(),
    updated_at: doc.updatedAt || doc.createdAt || new Date()
  };

  return { userRow, walletRow };
}

async function mapSessionToSupabaseRow(doc) {
  const userId = doc.userId ? await resolveSupabaseUserIdFromMongoUser(doc.userId) : null;
  return {
    id: stableUuid(doc._id || doc.jti || `session:${Date.now()}`),
    user_id: userId,
    jti: doc.jti || String(doc._id || crypto.randomUUID()),
    scope: ['user', 'admin'].includes(doc.scope) ? doc.scope : 'user',
    ip_address: doc.ip || null,
    user_agent: doc.userAgent || null,
    revoked_at: doc.revokedAt || null,
    expires_at: doc.expiresAt || new Date(),
    created_at: doc.createdAt || new Date()
  };
}

async function mapSecurityEventToSupabaseRow(doc) {
  const userId = doc.userId ? await resolveSupabaseUserIdFromMongoUser(doc.userId) : null;
  return {
    id: stableUuid(doc._id || `security:${Date.now()}`),
    user_id: userId,
    event: ['login_success', 'login_failed', 'new_device', 'email_verified', 'session_revoked', 'withdrawal_risk'].includes(doc.event) ? doc.event : 'login_failed',
    ip_address: doc.ip || null,
    user_agent: doc.userAgent || null,
    metadata: normalizeMetadata(doc.metadata || {}),
    created_at: doc.createdAt || new Date()
  };
}

async function mapTransactionToSupabaseRow(doc) {
  const userId = doc.userId ? await resolveSupabaseUserIdFromMongoUser(doc.userId) : null;
  return {
    id: stableUuid(doc._id || doc.txHash || `tx:${Date.now()}`),
    user_id: userId,
    type: ['deposit', 'withdraw', 'reward', 'staking_reward', 'referral_commission', 'upgrade_deduction', 'token_burn', 'vault_lock', 'vault_release', 'vault_early_release', 'vault_penalty', 'admin_adjustment'].includes(doc.type) ? doc.type : 'deposit',
    status: ['pending', 'approved', 'rejected'].includes(doc.status) ? doc.status : 'pending',
    amount: safeNumber(doc.amount, 0),
    gross_amount: safeNumber(doc.grossAmount, 0),
    usdt_amount: safeNumber(doc.usdtAmount, 0),
    opx_amount: safeNumber(doc.opxAmount, 0),
    fee_amount: safeNumber(doc.feeAmount, 0),
    net_amount: safeNumber(doc.netAmount, 0),
    wallet_address: doc.walletAddress || '',
    tx_hash: doc.txHash || null,
    network: doc.network || null,
    risk_score: safeNumber(doc.riskScore, 0),
    risk_level: ['low', 'medium', 'high'].includes(doc.riskLevel) ? doc.riskLevel : 'low',
    risk_flags: Array.isArray(doc.riskFlags) ? doc.riskFlags : [],
    idempotency_key: doc.idempotencyKey || null,
    created_at: doc.createdAt || new Date(),
    updated_at: doc.updatedAt || doc.createdAt || new Date()
  };
}

async function mapFinancialLedgerToSupabaseRow(doc) {
  const userId = doc.userId ? await resolveSupabaseUserIdFromMongoUser(doc.userId) : null;
  return {
    id: stableUuid(doc._id || `ledger:${Date.now()}`),
    user_id: userId,
    type: ['deposit', 'withdraw', 'reward', 'staking_reward', 'referral_commission', 'upgrade_deduction', 'token_burn', 'vault_lock', 'vault_release', 'vault_early_release', 'vault_penalty', 'admin_adjustment'].includes(doc.type) ? doc.type : 'deposit',
    currency: ['USDT', 'OPX'].includes(doc.currency) ? doc.currency : 'USDT',
    amount: safeNumber(doc.amount, 0),
    fee_amount: safeNumber(doc.feeAmount, 0),
    net_amount: safeNumber(doc.netAmount, 0),
    balance_before: safeNumber(doc.balanceBefore, 0),
    balance_after: safeNumber(doc.balanceAfter, 0),
    status: ['pending', 'approved', 'rejected'].includes(doc.status) ? doc.status : 'approved',
    source: doc.source || 'system',
    reference_id: doc.referenceId || null,
    notes: doc.notes || '',
    metadata: normalizeMetadata(doc.metadata || {}),
    created_at: doc.createdAt || new Date()
  };
}

async function mirrorRow(tableName, row, conflictKey) {
  const client = getSupabaseAdminClient();
  if (!client || !shouldMirrorToSupabase()) return { mirrored: false };

  try {
    if (conflictKey) {
      const { error } = await client.from(tableName).upsert(row, { onConflict: conflictKey });
      if (error) throw error;
    } else {
      const { error } = await client.from(tableName).insert(row);
      if (error) throw error;
    }
    return { mirrored: true };
  } catch (error) {
    console.warn(`Supabase mirror failed for ${tableName}:`, error.message);
    return { mirrored: false, error: error.message };
  }
}

async function maybeMirrorDocument(modelName, document) {
  if (!document || !shouldMirrorToSupabase()) return { mirrored: false };

  try {
    const doc = document.toObject ? document.toObject() : { ...document };

    switch (modelName) {
      case 'User': {
        const { userRow, walletRow } = await mapUserToSupabaseRow(doc);
        await mirrorRow('users', userRow, 'email');
        await mirrorRow('wallet_balances', walletRow, 'user_id');
        return { mirrored: true };
      }
      case 'Session': {
        const row = await mapSessionToSupabaseRow(doc);
        return mirrorRow('sessions', row, 'jti');
      }
      case 'SecurityEvent': {
        const row = await mapSecurityEventToSupabaseRow(doc);
        return mirrorRow('security_events', row);
      }
      case 'Transaction': {
        const row = await mapTransactionToSupabaseRow(doc);
        return mirrorRow('transactions', row, 'id');
      }
      case 'FinancialLedger': {
        const row = await mapFinancialLedgerToSupabaseRow(doc);
        return mirrorRow('financial_ledger', row, 'id');
      }
      default:
        return { mirrored: false };
    }
  } catch (error) {
    console.warn(`Supabase compatibility mirror failed for ${modelName}:`, error.message);
    return { mirrored: false, error: error.message };
  }
}

module.exports = {
  maybeMirrorDocument,
  shouldMirrorToSupabase,
  stableUuid,
  mapUserToSupabaseRow,
  mapSessionToSupabaseRow,
  mapSecurityEventToSupabaseRow,
  mapTransactionToSupabaseRow,
  mapFinancialLedgerToSupabaseRow
};
