function getDatabaseMode() {
  const explicitMode = (process.env.DATABASE_MODE || '').trim().toLowerCase();
  if (explicitMode === 'mongo') {
    console.warn('⚠️ MongoDB mode is disabled in production. The platform now requires Supabase only.');
    return 'supabase';
  }
  if (explicitMode === 'supabase' || explicitMode === '') {
    return 'supabase';
  }

  return 'supabase';
}

function assertSupabaseRuntimeReady() {
  if (!isSupabaseEnabled()) {
    throw new Error('Production database is configured for Supabase only. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY before startup.');
  }
  return true;
}

function getRuntimeDatabaseInfo() {
  const mode = getDatabaseMode();
  const mongoConfigured = false;
  const supabaseConfigured = isSupabaseEnabled();

  return {
    mode,
    mongoConfigured,
    supabaseConfigured,
    shouldUseSupabase: true,
    shouldUseMongo: false,
    canFallbackToMongo: false,
    safeCutoverReady: mode === 'supabase' && supabaseConfigured
  };
}

function hasLegacyMongo() {
  return false;
}

function isSupabaseEnabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function connectDatabase() {
  const mode = getDatabaseMode();
  const runtimeInfo = getRuntimeDatabaseInfo();

  assertSupabaseRuntimeReady();

  console.log('✅ Production runtime is locked to Supabase. MongoDB is fully disabled.');
  return { mode, connected: true, legacyMongo: false, ...runtimeInfo };
}

async function closeDatabase() {
  return Promise.resolve();
}

module.exports = {
  connectDatabase,
  closeDatabase,
  getDatabaseMode,
  getRuntimeDatabaseInfo,
  hasLegacyMongo,
  isSupabaseEnabled,
  assertSupabaseRuntimeReady
};
