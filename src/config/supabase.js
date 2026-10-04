const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are not configured yet. Set SUPABASE_URL and SUPABASE_ANON_KEY before switching the app to Supabase.');
}

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : null;

const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : null;

async function checkSupabaseConnection() {
  const financialSchema = {
    depositTablesReady: false,
    payoutTableReady: false,
    ready: false
  };
  if (!supabaseAdmin) return { configured: false, reachable: false, financialSchema };

  const { error } = await supabaseAdmin.from('users').select('id').limit(1);
  if (error) return { configured: true, reachable: false, error: error.message, financialSchema };

  const depositTables = ['tron_deposit_addresses', 'tron_deposit_address_sequences', 'tron_deposit_events'];
  const depositChecks = await Promise.all(depositTables.map(table =>
    supabaseAdmin.from(table).select('id').limit(0).then(({ error: tableError }) => !tableError).catch(() => false)
  ));
  const payoutCheck = await supabaseAdmin.from('withdrawal_payouts').select('id').limit(0)
    .then(({ error: tableError }) => !tableError).catch(() => false);
  financialSchema.depositTablesReady = depositChecks.every(Boolean);
  financialSchema.payoutTableReady = payoutCheck;
  financialSchema.ready = financialSchema.depositTablesReady && financialSchema.payoutTableReady;
  return { configured: true, reachable: true, error: null, financialSchema };
}

module.exports = { supabase, supabaseAdmin, checkSupabaseConnection };
