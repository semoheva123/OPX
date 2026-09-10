function getDatabaseMode() {
  const explicitMode = (process.env.DATABASE_MODE || '').trim().toLowerCase();
  if (explicitMode === 'supabase') return 'supabase';
  if (explicitMode === 'mongo') return 'mongo';

  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  if (hasSupabaseConfig) return 'supabase';

  return 'mongo';
}

function getRuntimeDatabaseInfo() {
  const mode = getDatabaseMode();
  const mongoConfigured = false;
  const supabaseConfigured = isSupabaseEnabled();

  return {
    mode,
    mongoConfigured,
    supabaseConfigured,
    shouldUseSupabase: mode === 'supabase',
    shouldUseMongo: false,
    canFallbackToMongo: false,
    safeCutoverReady: mode === 'supabase'
  };
}

function hasLegacyMongo() {
  return false;
}

function isSupabaseEnabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

async function connectDatabase() {
  const mode = getDatabaseMode();
  const runtimeInfo = getRuntimeDatabaseInfo();

  if (mode === 'supabase') {
    console.log('✅ DATABASE_MODE=supabase: Supabase is the only active database configuration.');
    return { mode, connected: false, legacyMongo: false, ...runtimeInfo };
  }

  console.warn('⚠️ Legacy MongoDB mode is disabled. The project is configured for Supabase only.');
  return { mode, connected: false, legacyMongo: false, ...runtimeInfo };
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
  isSupabaseEnabled
};
