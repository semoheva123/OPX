const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const SecurityEvent = require('../models/SecurityEvent');
const Transaction = require('../models/Transaction');
const FinancialLedger = require('../models/FinancialLedger');
const VipLevel = require('../models/VipLevel');
const GameSetting = require('../models/GameSetting');
const Notification = require('../models/Notification');
const SupportTicket = require('../models/SupportTicket');
const SocialFollow = require('../models/SocialFollow');
const SocialPost = require('../models/SocialPost');
const Message = require('../models/Message');
const Broadcast = require('../models/Broadcast');
const Coupon = require('../models/Coupon');
const CpaLeadConversion = require('../models/CpaLeadConversion');
const ExternalTask = require('../models/ExternalTask');
const InvestmentVault = require('../models/InvestmentVault');
const InvestmentVaultContract = require('../models/InvestmentVaultContract');
const Staking = require('../models/Staking');
const TaskCompletion = require('../models/TaskCompletion');
const { supabaseAdmin } = require('../config/supabase');
const { getDatabaseMode } = require('../config/database');

const modelMap = {
  User: { model: User, table: 'users' },
  Session: { model: Session, table: 'sessions' },
  SecurityEvent: { model: SecurityEvent, table: 'security_events' },
  Transaction: { model: Transaction, table: 'transactions' },
  FinancialLedger: { model: FinancialLedger, table: 'financial_ledger' },
  VipLevel: { model: VipLevel, table: 'vip_levels' },
  GameSetting: { model: GameSetting, table: 'game_settings' },
  Notification: { model: Notification, table: 'notifications' },
  SupportTicket: { model: SupportTicket, table: 'support_tickets' },
  SocialFollow: { model: SocialFollow, table: 'social_follows' },
  SocialPost: { model: SocialPost, table: 'social_posts' },
  Message: { model: Message, table: 'messages' }
  ,Broadcast: { model: Broadcast, table: 'broadcasts' }
  ,Coupon: { model: Coupon, table: 'coupons' }
  ,CpaLeadConversion: { model: CpaLeadConversion, table: 'cpa_lead_conversions' }
  ,ExternalTask: { model: ExternalTask, table: 'external_tasks' }
  ,InvestmentVault: { model: InvestmentVault, table: 'investment_vault' }
  ,InvestmentVaultContract: { model: InvestmentVaultContract, table: 'investment_vault_contracts' }
  ,Staking: { model: Staking, table: 'stakings' }
  ,TaskCompletion: { model: TaskCompletion, table: 'task_completions' }
};

function isSupabaseRuntime() {
  const mode = (getDatabaseMode() || '').toLowerCase();
  return mode === 'supabase' || mode === 'hybrid';
}

function toSnakeCaseKey(key) {
  if (key === '_id') return 'id';
  if (key === 'id') return 'id';
  if (key === 'USDT_balance') return 'usdt_balance';
  if (key === 'OPX_balance') return 'opx_balance';

  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

function toCamelCaseKey(key) {
  if (key === 'id') return 'id';
  const aliases = {
    password_hash: 'password',
    email_verified: 'emailVerified',
    is_banned: 'isBanned',
    tier_code: 'tierCode',
    referral_code: 'referralCode',
    referred_by: 'referredBy',
    wallet_address: 'walletAddress',
    kyc_status: 'kycStatus',
    two_factor_enabled: 'twoFactorEnabled',
    two_factor_secret: 'twoFactorSecret',
    admin_two_factor_enabled: 'adminTwoFactorEnabled',
    admin_two_factor_secret: 'adminTwoFactorSecret',
    asset_wallet: 'assetWallet',
    last_login_at: 'lastLoginAt'
  };
  if (aliases[key]) return aliases[key];
  if (key === 'usdt_balance') return 'USDT_balance';
  if (key === 'opx_balance') return 'OPX_balance';

  return String(key).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function normalizeSupabaseDoc(doc = {}) {
  if (!doc || typeof doc !== 'object') return {};
  const clone = { ...doc };
  const result = {};

  Object.keys(clone).forEach((key) => {
    if (clone[key] === undefined) return;
    const normalizedKey = toSnakeCaseKey(key);
    result[normalizedKey] = clone[key];
  });

  return result;
}

function normalizeSupabaseResult(data) {
  if (Array.isArray(data)) return data.map(normalizeSupabaseResult);
  if (!data || typeof data !== 'object') return data;

  const result = {};
  Object.keys(data).forEach((key) => {
    if (data[key] === undefined) return;
    const normalizedKey = toCamelCaseKey(key);
    result[normalizedKey] = normalizeSupabaseResult(data[key]);
  });

  if (result.id && !result._id) result._id = result.id;

  return result;
}

function flattenMongoFilter(query = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(query)) {
    const normalizedKey = toSnakeCaseKey(key);
    if (normalizedKey === 'id' && value && typeof value === 'string') {
      normalized.id = String(value);
    } else if (normalizedKey === 'email' && typeof value === 'string') {
      normalized.email = String(value).toLowerCase();
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if ('$eq' in value) normalized[normalizedKey] = value.$eq;
      else if ('$ne' in value) normalized[normalizedKey] = value.$ne;
      else if ('$gt' in value) normalized[normalizedKey] = value.$gt;
      else if ('$gte' in value) normalized[normalizedKey] = value.$gte;
      else if ('$lt' in value) normalized[normalizedKey] = value.$lt;
      else if ('$lte' in value) normalized[normalizedKey] = value.$lte;
      else if ('$in' in value) normalized[normalizedKey] = value.$in;
      else if ('$nin' in value) normalized[normalizedKey] = value.$nin;
      else normalized[normalizedKey] = value;
    } else {
      normalized[normalizedKey] = value;
    }
  }
  return normalized;
}

async function supabaseFindOne(table, query = {}) {
  if (!supabaseAdmin) return null;
  const filters = flattenMongoFilter(query);
  let req = supabaseAdmin.from(table).select('*');

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      req = req.in(key, value);
    } else if (typeof value === 'object') {
      continue;
    } else {
      req = req.eq(key, value);
    }
  }

  const { data, error } = await req.maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw error;
  }
  const result = normalizeSupabaseResult(data || null);
  if (result && table === 'users' && result.id) {
    const wallet = await supabaseAdmin.from('wallet_balances').select('*').eq('user_id', result.id).maybeSingle();
    if (!wallet.error && wallet.data) {
      const walletData = normalizeSupabaseResult(wallet.data);
      result.wallet = {
        balance: walletData.balance || 0,
        depositBalance: walletData.depositBalance || 0,
        profitBalance: walletData.profitBalance || 0,
        totalDeposits: walletData.totalDeposits || 0,
        totalWithdrawn: walletData.totalWithdrawn || 0
      };
    }
  }
  return result;
}

async function supabaseFind(table, query = {}) {
  if (!supabaseAdmin) return [];
  const filters = flattenMongoFilter(query);
  let req = supabaseAdmin.from(table).select('*');

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) req = req.in(key, value);
    else req = req.eq(key, value);
  }

  const { data, error } = await req;
  if (error) throw error;
  return normalizeSupabaseResult(data || []);
}

async function supabaseInsert(table, payload) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from(table).insert(payload).select('*');
  if (error) throw error;
  return normalizeSupabaseResult(data?.[0] || null);
}

async function supabaseUpdateOne(table, query, changes) {
  if (!supabaseAdmin) return null;
  const filters = flattenMongoFilter(query);
  let req = supabaseAdmin.from(table).update(normalizeSupabaseDoc(changes));
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    req = req.eq(key, value);
  }
  const { data, error } = await req.select('*');
  if (error) throw error;
  return normalizeSupabaseResult(data?.[0] || null);
}

async function supabaseCountDocuments(table, query = {}) {
  if (!supabaseAdmin) return 0;
  const filters = flattenMongoFilter(query);
  let req = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    req = req.eq(key, value);
  }
  const { count, error } = await req;
  if (error) throw error;
  return Number(count || 0);
}

const createRepository = (name) => {
  const target = modelMap[name];
  if (!target) {
    return {
      findOne: async () => null,
      find: async () => [],
      create: async (data) => data,
      countDocuments: async () => 0,
      updateOne: async () => ({ modifiedCount: 0 }),
      updateMany: async () => ({ modifiedCount: 0 }),
      aggregate: async () => []
    };
  }

  return {
    async findOne(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne(target.table, query);
      }
      return target.model.findOne(query);
    },
    async find(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFind(target.table, query);
      }
      return target.model.find(query);
    },
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseInsert(target.table, normalizeSupabaseDoc(data));
      }
      return target.model.create(data);
    },
    async countDocuments(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseCountDocuments(target.table, query);
      }
      return target.model.countDocuments(query);
    },
    async updateOne(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseUpdateOne(target.table, filter, update.$set || update);
      }
      return target.model.updateOne(filter, update);
    },
    async updateMany(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return { matchedCount: await supabaseCountDocuments(target.table, filter) };
      }
      return target.model.updateMany(filter, update);
    },
    async aggregate(pipeline = []) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return [];
      }
      return target.model.aggregate(pipeline);
    }
  };
};

const dataAccess = {
  isSupabaseRuntime,
  user: {
    async findByEmail(email) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('users', { email: String(email).trim().toLowerCase() });
      }
      return User.findOne({ email: String(email).trim().toLowerCase() });
    },
    async findById(id) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('users', { id: String(id) });
      }
      return User.findById(id);
    },
    async findOne(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('users', query);
      }
      return User.findOne(query);
    },
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        const payload = normalizeSupabaseDoc({ ...data, password_hash: data.password || data.password_hash });
        delete payload.password;
        delete payload.wallet;
        const user = await supabaseInsert('users', payload);
        if (user?.id) {
          await supabaseAdmin.from('wallet_balances').upsert({
            user_id: user.id,
            balance: Number(data.wallet?.balance || 0),
            deposit_balance: Number(data.wallet?.depositBalance || 0),
            profit_balance: Number(data.wallet?.profitBalance || 0),
            total_deposits: Number(data.wallet?.totalDeposits || 0),
            total_withdrawn: Number(data.wallet?.totalWithdrawn || 0),
            usdt_balance: Number(data.USDT_balance || 0),
            opx_balance: Number(data.OPX_balance || 0)
          }, { onConflict: 'user_id' });
          user.wallet = data.wallet || { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 };
        }
        return user;
      }
      return User.create(data);
    },
    async updateOne(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseUpdateOne('users', filter, update.$set || update);
      return User.updateOne(filter, update);
    },
    async countDocuments(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseCountDocuments('users', query);
      }
      return User.countDocuments(query);
    }
  },
  session: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseInsert('sessions', normalizeSupabaseDoc({
          id: data._id || new mongoose.Types.ObjectId().toString(),
          user_id: data.userId ? String(data.userId) : null,
          jti: data.jti,
          scope: data.scope || 'user',
          ip_address: data.ip || null,
          user_agent: data.userAgent || null,
          revoked_at: data.revokedAt || null,
          expires_at: data.expiresAt || new Date(),
          created_at: data.createdAt || new Date()
        }));
      }
      return Session.create(data);
    },
    async updateMany(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return { matchedCount: await supabaseCountDocuments('sessions', filter) };
      }
      return Session.updateMany(filter, update);
    },
    async findOne(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('sessions', query);
      }
      return Session.findOne(query);
    }
  },
  securityEvent: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseInsert('security_events', normalizeSupabaseDoc({
          id: data._id || new mongoose.Types.ObjectId().toString(),
          user_id: data.userId ? String(data.userId) : null,
          event: data.event,
          ip_address: data.ip || null,
          user_agent: data.userAgent || null,
          metadata: data.metadata || {},
          created_at: data.createdAt || new Date()
        }));
      }
      return SecurityEvent.create(data);
    },
    async countDocuments(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseCountDocuments('security_events', query);
      }
      return SecurityEvent.countDocuments(query);
    }
  },
  vipLevel: createRepository('VipLevel'),
  gameSetting: createRepository('GameSetting'),
  notification: createRepository('Notification'),
  supportTicket: createRepository('SupportTicket'),
  socialFollow: createRepository('SocialFollow'),
  socialPost: createRepository('SocialPost'),
  message: createRepository('Message'),
  broadcast: createRepository('Broadcast'),
  coupon: createRepository('Coupon'),
  cpaLeadConversion: createRepository('CpaLeadConversion'),
  externalTask: createRepository('ExternalTask'),
  investmentVault: createRepository('InvestmentVault'),
  investmentVaultContract: createRepository('InvestmentVaultContract'),
  staking: createRepository('Staking'),
  taskCompletion: createRepository('TaskCompletion'),
  transaction: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        const payload = normalizeSupabaseDoc({
          id: data._id || new mongoose.Types.ObjectId().toString(),
          user_id: data.userId ? String(data.userId) : null,
          type: data.type,
          status: data.status || 'pending',
          amount: Number(data.amount || 0),
          gross_amount: Number(data.grossAmount || 0),
          usdt_amount: Number(data.usdtAmount || 0),
          opx_amount: Number(data.opxAmount || 0),
          fee_amount: Number(data.feeAmount || 0),
          net_amount: Number(data.netAmount || 0),
          wallet_address: data.walletAddress || '',
          tx_hash: data.txHash || null,
          network: data.network || null,
          risk_score: Number(data.riskScore || 0),
          risk_level: data.riskLevel || 'low',
          risk_flags: Array.isArray(data.riskFlags) ? data.riskFlags : [],
          idempotency_key: data.idempotencyKey || null,
          created_at: data.createdAt || new Date(),
          updated_at: data.updatedAt || data.createdAt || new Date()
        });
        return supabaseInsert('transactions', payload);
      }
      return Transaction.create(data);
    },
    async findOne(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('transactions', query);
      }
      return Transaction.findOne(query);
    },
    async aggregate(pipeline = []) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return [];
      }
      return Transaction.aggregate(pipeline);
    }
  },
  financialLedger: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        const payload = normalizeSupabaseDoc({
          id: data._id || new mongoose.Types.ObjectId().toString(),
          user_id: data.userId ? String(data.userId) : null,
          type: data.type,
          currency: data.currency || 'USDT',
          amount: Number(data.amount || 0),
          fee_amount: Number(data.feeAmount || 0),
          net_amount: Number(data.netAmount || 0),
          balance_before: Number(data.balanceBefore || 0),
          balance_after: Number(data.balanceAfter || 0),
          status: data.status || 'approved',
          source: data.source || 'system',
          reference_id: data.referenceId || null,
          notes: data.notes || '',
          metadata: data.metadata || {},
          created_at: data.createdAt || new Date()
        });
        return supabaseInsert('financial_ledger', payload);
      }
      return FinancialLedger.create(data);
    }
  }
};

module.exports = dataAccess;
