const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');

const User = require('../src/models/User');
const Session = require('../src/models/Session');
const SecurityEvent = require('../src/models/SecurityEvent');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

function toNum(value, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeMetadata(obj = {}) {
  if (!obj || typeof obj !== 'object') return {};
  const copy = { ...obj };
  for (const key of Object.keys(copy)) {
    if (copy[key] === undefined) delete copy[key];
    if (typeof copy[key] === 'string' && copy[key].length > 5000) copy[key] = copy[key].slice(0, 5000);
  }
  return copy;
}

function mapUserToSupabaseRecord(user) {
  const wallet = user.wallet || {};
  const role = ['user', 'admin', 'financial_admin', 'support_admin', 'monitor'].includes(user.role) ? user.role : 'user';
  const kycStatus = ['not_started', 'pending', 'verified', 'rejected'].includes(user.kycStatus) ? user.kycStatus : 'not_started';
  const id = randomUUID();
  const record = {
    id,
    email: user.email || `legacy-${String(user._id)}@migrated.local`,
    password_hash: user.password || '',
    role,
    email_verified: Boolean(user.emailVerified),
    is_banned: Boolean(user.isBanned),
    tier_code: String(user.tierCode || 'A1').toUpperCase().slice(0, 20),
    referral_code: user.referralCode || null,
    referred_by: user.referredBy || null,
    wallet_address: user.walletAddress || '',
    kyc_status: kycStatus,
    two_factor_enabled: Boolean(user.twoFactorEnabled),
    two_factor_secret: user.twoFactorSecret || null,
    admin_two_factor_enabled: Boolean(user.adminTwoFactorEnabled),
    admin_two_factor_secret: user.adminTwoFactorSecret || null,
    asset_wallet: toNum(user.assetWallet, 0),
    created_at: user.createdAt || new Date(),
    updated_at: user.updatedAt || user.createdAt || new Date(),
    last_login_at: user.lastLoginAt || null,
    metadata: sanitizeMetadata({
      ...user,
      _id: undefined,
      password: undefined,
      emailVerificationToken: undefined,
      emailVerificationExpire: undefined,
      resetOTP: undefined,
      resetOTPExpire: undefined,
      twoFactorSecret: undefined,
      adminTwoFactorSecret: undefined,
      adminInviteToken: undefined,
      adminInviteExpire: undefined,
      password_hash: undefined,
      wallet: undefined,
      __v: undefined,
      id: undefined
    })
  };

  return { id, record, walletRecord: {
    user_id: id,
    balance: toNum(wallet.balance, 0),
    deposit_balance: toNum(wallet.depositBalance, 0),
    profit_balance: toNum(wallet.profitBalance, 0),
    total_deposits: toNum(wallet.totalDeposits, 0),
    total_withdrawn: toNum(wallet.totalWithdrawn, 0),
    usdt_balance: toNum(user.USDT_balance, 0),
    opx_balance: toNum(user.OPX_balance, 0),
    created_at: user.createdAt || new Date(),
    updated_at: user.updatedAt || user.createdAt || new Date()
  } };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const users = await User.find({}).lean();
    const sessions = await Session.find({}).lean();
    const securityEvents = await SecurityEvent.find({}).lean();

    const userIdMap = new Map();
    const userRows = [];
    const walletRows = [];

    for (const user of users) {
      const mapped = mapUserToSupabaseRecord(user);
      userIdMap.set(String(user._id), mapped.id);
      userRows.push(mapped.record);
      walletRows.push(mapped.walletRecord);
    }

    if (userRows.length > 0) {
      const { error: userError } = await supabase.from('users').upsert(userRows, { onConflict: 'email' });
      if (userError) throw new Error(`users upsert failed: ${userError.message}`);

      const { error: walletError } = await supabase.from('wallet_balances').upsert(walletRows, { onConflict: 'user_id' });
      if (walletError) throw new Error(`wallet_balances upsert failed: ${walletError.message}`);
    }

    const sessionRows = sessions.map((session) => {
      const userId = userIdMap.get(String(session.userId));
      if (!userId) return null;
      return {
        user_id: userId,
        jti: session.jti || `${session._id}`,
        scope: ['user', 'admin'].includes(session.scope) ? session.scope : 'user',
        ip_address: session.ip || session.ip_address || null,
        user_agent: session.userAgent || null,
        revoked_at: session.revokedAt || null,
        expires_at: session.expiresAt || new Date(),
        created_at: session.createdAt || new Date()
      };
    }).filter(Boolean);

    if (sessionRows.length > 0) {
      const { error: sessionError } = await supabase.from('sessions').upsert(sessionRows, { onConflict: 'jti' });
      if (sessionError) throw new Error(`sessions upsert failed: ${sessionError.message}`);
    }

    const securityRows = securityEvents.map((event) => ({
      id: randomUUID(),
      user_id: event.userId ? userIdMap.get(String(event.userId)) || null : null,
      event: ['login_success', 'login_failed', 'new_device', 'email_verified', 'session_revoked', 'withdrawal_risk'].includes(event.event) ? event.event : 'login_failed',
      ip_address: event.ip || null,
      user_agent: event.userAgent || null,
      metadata: sanitizeMetadata({ email: event.email, ...event.metadata }),
      created_at: event.createdAt || new Date()
    }));

    if (securityRows.length > 0) {
      const { error: securityError } = await supabase.from('security_events').insert(securityRows);
      if (securityError) throw new Error(`security_events insert failed: ${securityError.message}`);
    }

    const counts = {};
    for (const table of ['users', 'wallet_balances', 'sessions', 'security_events']) {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (error) throw new Error(`${table}: ${error.message}`);
      counts[table] = count || 0;
    }

    console.log(JSON.stringify({
      migrated: {
        users: userRows.length,
        walletBalances: walletRows.length,
        sessions: sessionRows.length,
        securityEvents: securityRows.length
      },
      supabaseCounts: counts,
      writesPerformed: true
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});
