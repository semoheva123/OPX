const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getDatabaseMode, assertSupabaseRuntimeReady } = require('../config/database');

const modelMap = {
  User: { table: 'users' },
  Session: { table: 'sessions' },
  SecurityEvent: { table: 'security_events' },
  Transaction: { table: 'transactions' },
  FinancialLedger: { table: 'financial_ledger' },
  VipLevel: { table: 'vip_levels' },
  GameSetting: { table: 'game_settings' },
  GeneralSetting: { table: 'general_settings' },
  Notification: { table: 'notifications' },
  SupportTicket: { table: 'support_tickets' },
  SocialFollow: { table: 'social_follows' },
  SocialPost: { table: 'social_posts' },
  Message: { table: 'messages' },
  Broadcast: { table: 'broadcasts' },
  Coupon: { table: 'coupons' },
  CpaLeadConversion: { table: 'cpa_lead_conversions' },
  InvestmentVault: { table: 'investment_vault' },
  InvestmentVaultContract: { table: 'investment_vault_contracts' },
  Staking: { table: 'stakings' },
  AuditLog: { table: 'audit_logs' }
};

function isSupabaseRuntime() {
  const mode = (getDatabaseMode() || '').toLowerCase();
  return mode === 'supabase' || mode === 'hybrid';
}

function toSnakeCaseKey(key) {
  if (key === '_id') return 'id';
  if (key === 'id') return 'id';
  if (key === 'ip') return 'ip_address';
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
    result[normalizedKey] = clone[key] instanceof Date ? clone[key].toISOString() : clone[key];
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

function applySupabaseFilters(request, query = {}) {
  let result = request;
  for (const [rawKey, rawValue] of Object.entries(query)) {
    const key = toSnakeCaseKey(rawKey);
    if (rawKey === '$or' || rawKey === '$and') continue;
    if (rawValue === null) {
      result = result.is(key, null);
      continue;
    }
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      for (const [operator, value] of Object.entries(rawValue)) {
        const normalizedValue = value instanceof Date ? value.toISOString() : value;
        if (operator === '$eq') result = normalizedValue === null ? result.is(key, null) : result.eq(key, normalizedValue);
        else if (operator === '$ne') result = normalizedValue === null ? result.not(key, 'is', null) : result.neq(key, normalizedValue);
        else if (operator === '$gt') result = result.gt(key, normalizedValue);
        else if (operator === '$gte') result = result.gte(key, normalizedValue);
        else if (operator === '$lt') result = result.lt(key, normalizedValue);
        else if (operator === '$lte') result = result.lte(key, normalizedValue);
        else if (operator === '$in') result = result.in(key, Array.isArray(value) ? value.map(item => item instanceof Date ? item.toISOString() : item) : value);
        else if (operator === '$nin') result = result.not(key, 'in', `(${value.join(',')})`);
        else if (operator === '$exists') result = value ? result.not(key, 'is', null) : result.is(key, null);
      }
      continue;
    }
    if (Array.isArray(rawValue)) result = result.in(key, rawValue);
    else result = result.eq(key, rawKey === 'email' ? String(rawValue).toLowerCase() : rawValue instanceof Date ? rawValue.toISOString() : rawValue);
  }
  return result;
}

async function supabaseFindOne(table, query = {}) {
  if (!supabaseAdmin) return null;
  let req = supabaseAdmin.from(table).select('*');
  req = applySupabaseFilters(req, query);

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
        totalWithdrawn: walletData.totalWithdrawn || 0,
        USDT_balance: walletData.USDT_balance || 0,
        OPX_balance: walletData.OPX_balance || 0
      };
    }
  }
  return result;
}

function normalizeSelect(select) {
  if (!select) return '*';
  return String(select).split(/\s+/).filter(Boolean).map(toSnakeCaseKey).join(',');
}

function applyQueryOptions(request, options = {}) {
  let result = request;
  const sort = options.sort || {};
  for (const [key, direction] of Object.entries(sort)) {
    result = result.order(toSnakeCaseKey(key), { ascending: Number(direction) >= 0 });
  }
  if (Number.isFinite(Number(options.limit))) result = result.limit(Number(options.limit));
  return result;
}

async function supabaseFind(table, query = {}, options = {}) {
  if (!supabaseAdmin) return [];
  let req = supabaseAdmin.from(table).select(normalizeSelect(options.select));
  req = applySupabaseFilters(req, query);

  req = applyQueryOptions(req, options);
  const { data, error } = await req;
  if (error) throw error;
  const result = normalizeSupabaseResult(data || []);
  if (table === 'users' && result.length) {
    const ids = result.map(item => item.id || item._id).filter(Boolean);
    const wallets = await supabaseAdmin.from('wallet_balances').select('*').in('user_id', ids);
    if (!wallets.error) {
      const walletByUserId = new Map((wallets.data || []).map(wallet => [String(wallet.user_id), normalizeSupabaseResult(wallet)]));
      result.forEach(user => {
        const wallet = walletByUserId.get(String(user.id || user._id));
        if (wallet) user.wallet = { balance: wallet.balance || 0, depositBalance: wallet.depositBalance || 0, profitBalance: wallet.profitBalance || 0, totalDeposits: wallet.totalDeposits || 0, totalWithdrawn: wallet.totalWithdrawn || 0, USDT_balance: wallet.USDT_balance || 0, OPX_balance: wallet.OPX_balance || 0 };
      });
    }
  }
  return result;
}

async function supabaseInsert(table, payload) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from(table).insert(payload).select('*');
  if (error) throw error;
  return normalizeSupabaseResult(data?.[0] || null);
}

async function supabaseUpsert(table, payload, onConflict) {
  if (!supabaseAdmin) return null;
  const normalizedPayload = Array.isArray(payload) ? payload.map(normalizeSupabaseDoc) : normalizeSupabaseDoc(payload);
  const { data, error } = await supabaseAdmin.from(table).upsert(normalizedPayload, { onConflict, ignoreDuplicates: true }).select('*');
  if (error) throw error;
  return normalizeSupabaseResult(data || []);
}

async function supabaseUpdateOne(table, query, changes) {
  if (!supabaseAdmin) return null;
  let req = supabaseAdmin.from(table).update(normalizeSupabaseDoc(changes));
  req = applySupabaseFilters(req, query);
  const { data, error } = await req.select('*');
  if (error) throw error;
  return normalizeSupabaseResult(data?.[0] || null);
}

async function supabaseUpdateMany(table, query, changes) {
  if (!supabaseAdmin) return { matchedCount: 0, modifiedCount: 0 };
  let req = supabaseAdmin.from(table).update(normalizeSupabaseDoc(changes), { count: 'exact' });
  req = applySupabaseFilters(req, query);
  const { count, error } = await req;
  if (error) throw error;
  return { matchedCount: Number(count || 0), modifiedCount: Number(count || 0) };
}

async function supabaseDeleteOne(table, query) {
  if (!supabaseAdmin) return null;
  let req = supabaseAdmin.from(table).delete().select('*');
  req = applySupabaseFilters(req, query);
  const { data, error } = await req.limit(1);
  if (error) throw error;
  return normalizeSupabaseResult(data?.[0] || null);
}

async function callSupabaseRpc(functionName, args) {
  if (!supabaseAdmin) {
    assertSupabaseRuntimeReady();
  }
  const { data, error } = await supabaseAdmin.rpc(functionName, args);
  if (error) throw error;
  return normalizeSupabaseResult(data);
}

async function supabaseUpdateUser(query, changes) {
  if (!supabaseAdmin) return null;
  const current = await supabaseFindOne('users', query);
  if (!current) return null;
  const nextWallet = { ...(current.wallet || {}) };
  const userChanges = { ...changes };
  if (userChanges.wallet && typeof userChanges.wallet === 'object') {
    Object.assign(nextWallet, userChanges.wallet);
    delete userChanges.wallet;
  }
  if (userChanges.USDT_balance !== undefined) {
    nextWallet.usdt_balance = userChanges.USDT_balance;
    delete userChanges.USDT_balance;
  }
  if (userChanges.OPX_balance !== undefined) {
    nextWallet.opx_balance = userChanges.OPX_balance;
    delete userChanges.OPX_balance;
  }
  const user = await supabaseUpdateOne('users', { id: current.id }, userChanges);
  const walletChanges = {};
  for (const [key, value] of Object.entries(nextWallet)) {
    if (value !== undefined && key !== 'balance') walletChanges[toSnakeCaseKey(key)] = value;
  }
  if (nextWallet.depositBalance !== undefined || nextWallet.profitBalance !== undefined) {
    walletChanges.balance = Number((Number(nextWallet.depositBalance || 0) + Number(nextWallet.profitBalance || 0)).toFixed(2));
  }
  if (Object.keys(walletChanges).length) await supabaseAdmin.from('wallet_balances').update(walletChanges).eq('user_id', current.id);
  return supabaseFindOne('users', { id: current.id });
}

async function supabaseCountDocuments(table, query = {}) {
  if (!supabaseAdmin) return 0;
  let req = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  req = applySupabaseFilters(req, query);
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
      return null;
    },
    async find(query = {}, options = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFind(target.table, query, options);
      }
      return [];
    },
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseInsert(target.table, normalizeSupabaseDoc(data));
      }
      return data;
    },
    async upsert(data, options = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseUpsert(target.table, data, options.onConflict);
      return [];
    },
    async countDocuments(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseCountDocuments(target.table, query);
      }
      return 0;
    },
    async exists(query = {}) {
      return (await this.countDocuments(query)) > 0;
    },
    async updateOne(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseUpdateOne(target.table, filter, update.$set || update);
      }
      return { modifiedCount: 0 };
    },
    async updateMany(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseUpdateMany(target.table, filter, update.$set || update);
      }
      return { modifiedCount: 0 };
    },
    async deleteOne(filter) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseDeleteOne(target.table, filter);
      return null;
    },
    async aggregate(pipeline = []) {
      return [];
    }
  };
};

const dataAccess = {
  isSupabaseRuntime,
  callSupabaseRpc,
  user: {
    async findByEmail(email) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('users', { email: String(email).trim().toLowerCase() });
      }
      return null;
    },
    async findById(id) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('users', { id: String(id) });
      }
      return null;
    },
    async findOne(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('users', query);
      }
      return null;
    },
    async find(query = {}, options = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseFind('users', query, options);
      return [];
    },
    async create(data) {
      if (isSupabaseRuntime()) {
        assertSupabaseRuntimeReady();
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
      return null;
    },
    async updateOne(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseUpdateUser(filter, update.$set || update);
      return { modifiedCount: 0 };
    },
    async countDocuments(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseCountDocuments('users', query);
      }
      return 0;
    }
  },
  session: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseInsert('sessions', normalizeSupabaseDoc({
          id: data._id || crypto.randomUUID(),
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
      return null;
    },
    async updateMany(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseUpdateMany('sessions', filter, update.$set || update);
      }
      return { modifiedCount: 0 };
    },
    async findOne(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('sessions', query);
      }
      return null;
    },
    async find(query = {}, options = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseFind('sessions', query, options);
      return [];
    },
    async updateOne(filter, update) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseUpdateOne('sessions', filter, update.$set || update);
      return { modifiedCount: 0 };
    }
  },
  securityEvent: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseInsert('security_events', normalizeSupabaseDoc({
          id: data._id || crypto.randomUUID(),
          user_id: data.userId ? String(data.userId) : null,
          event: data.event,
          ip_address: data.ip || null,
          user_agent: data.userAgent || null,
          metadata: data.metadata || {},
          created_at: data.createdAt || new Date()
        }));
      }
      return null;
    },
    async countDocuments(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseCountDocuments('security_events', query);
      }
      return 0;
    },
    async find(query = {}, options = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseFind('security_events', query, options);
      return [];
    }
  },
  vipLevel: createRepository('VipLevel'),
  gameSetting: createRepository('GameSetting'),
  generalSetting: createRepository('GeneralSetting'),
  notification: createRepository('Notification'),
  supportTicket: createRepository('SupportTicket'),
  socialFollow: createRepository('SocialFollow'),
  socialPost: createRepository('SocialPost'),
  message: createRepository('Message'),
  broadcast: createRepository('Broadcast'),
  coupon: createRepository('Coupon'),
  cpaLeadConversion: createRepository('CpaLeadConversion'),
  investmentVault: createRepository('InvestmentVault'),
  investmentVaultContract: createRepository('InvestmentVaultContract'),
  staking: createRepository('Staking'),
  auditLog: createRepository('AuditLog'),
  transaction: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        const payload = normalizeSupabaseDoc({
          id: data._id || crypto.randomUUID(),
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
      return null;
    },
    async findOne(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        return supabaseFindOne('transactions', query);
      }
      return null;
    },
    async find(query = {}, options = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseFind('transactions', query, options);
      return [];
    },
    async countDocuments(query = {}) {
      if (isSupabaseRuntime() && supabaseAdmin) return supabaseCountDocuments('transactions', query);
      return 0;
    },
    async aggregate(pipeline = []) {
      return [];
    }
  },
  financialLedger: {
    async create(data) {
      if (isSupabaseRuntime() && supabaseAdmin) {
        const payload = normalizeSupabaseDoc({
          id: data._id || crypto.randomUUID(),
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
      return null;
    }
  }
};

module.exports = dataAccess;
