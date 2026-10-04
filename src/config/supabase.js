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
    missingDepositTables: ['tron_deposit_addresses', 'tron_deposit_address_sequences', 'tron_deposit_events'],
    ready: false
  };
  if (!supabaseAdmin) return { configured: false, reachable: false, financialSchema };

  const { error } = await supabaseAdmin.from('users').select('id').limit(1);
  if (error) return { configured: true, reachable: false, error: error.message, financialSchema };

  const depositTables = [
    { table: 'tron_deposit_addresses', keyColumn: 'user_id' },
    { table: 'tron_deposit_address_sequences', keyColumn: 'id' },
    { table: 'tron_deposit_events', keyColumn: 'id' }
  ];
  const depositChecks = await Promise.all(depositTables.map(async ({ table, keyColumn }) => ({
    table,
    ready: await supabaseAdmin.from(table).select(keyColumn).limit(0)
      .then(({ error: tableError }) => !tableError).catch(() => false)
  })
  ));
  const payoutCheck = await supabaseAdmin.from('withdrawal_payouts').select('id').limit(0)
    .then(({ error: tableError }) => !tableError).catch(() => false);
  financialSchema.depositTablesReady = depositChecks.every(check => check.ready);
  financialSchema.payoutTableReady = payoutCheck;
  financialSchema.missingDepositTables = depositChecks.filter(check => !check.ready).map(check => check.table);
  financialSchema.ready = financialSchema.depositTablesReady && financialSchema.payoutTableReady;
  return { configured: true, reachable: true, error: null, financialSchema };
}

module.exports = { supabase, supabaseAdmin, checkSupabaseConnection };
