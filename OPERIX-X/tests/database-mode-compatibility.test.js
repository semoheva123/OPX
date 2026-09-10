const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const database = require('../src/config/database');

const originalEnv = { ...process.env };

(async () => {
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon_key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
    delete process.env.DATABASE_MODE;
    assert.equal(database.getDatabaseMode(), 'supabase');
    assert.equal(database.hasLegacyMongo(), false);
    assert.equal(database.getRuntimeDatabaseInfo().shouldUseSupabase, true);
    assert.equal(database.getRuntimeDatabaseInfo().shouldUseMongo, false);
    assert.equal(database.getRuntimeDatabaseInfo().canFallbackToMongo, false);

    process.env.DATABASE_MODE = 'supabase';
    assert.equal(database.getDatabaseMode(), 'supabase');
    assert.equal(database.getRuntimeDatabaseInfo().safeCutoverReady, true);

    process.env.DATABASE_MODE = 'mongo';
    assert.equal(database.getDatabaseMode(), 'supabase');
    assert.equal(database.getRuntimeDatabaseInfo().shouldUseMongo, false);

    delete process.env.DATABASE_MODE;
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    assert.equal(database.getDatabaseMode(), 'supabase');

    console.log('✅ Strict Supabase cutover checks passed');
  } catch (error) {
    console.error('❌ Database compatibility mode checks failed');
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.env = { ...originalEnv };
  }
})();
