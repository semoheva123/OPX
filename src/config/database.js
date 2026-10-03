function getDatabaseMode() {
  const explicitMode = (process.env.DATABASE_MODE || '').trim().toLowerCase();
  if (explicitMode === 'supabase' || explicitMode === '') {
    return 'supabase';
  }

  return 'supabase';
}

function assertSupabaseRuntimeReady() {
  if (!isSupabaseEnabled()) {
    console.warn('⚠️ Supabase runtime is not configured yet. The app will continue in degraded mode without database writes.');
    return false;
  }
  return true;
}

function getRuntimeDatabaseInfo() {
  const mode = getDatabaseMode();
  const supabaseConfigured = isSupabaseEnabled();

  return {
    mode,
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

  if (!runtimeInfo.supabaseConfigured) {
    console.warn('⚠️ Production database is not configured. Continuing in degraded mode so the app can stay online.');
    return { mode, connected: false, ...runtimeInfo };
  }

  console.log('✅ Production runtime is locked to Supabase.');
  return { mode, connected: true, ...runtimeInfo };
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
