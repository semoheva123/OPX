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
    withdrawalEmailCodesReady: false,
    missingDepositTables: ['nowpayments_deposit_orders'],
    ready: false
  };
  if (!supabaseAdmin) return { configured: false, reachable: false, financialSchema };

  const { error } = await supabaseAdmin.from('users').select('id').limit(1);
  if (error) return { configured: true, reachable: false, error: error.message, financialSchema };

  const depositTables = [
    { table: 'nowpayments_deposit_orders', requiredColumns: 'payment_id,order_id,user_id,price_amount,pay_amount,pay_currency,pay_address,payment_status,transaction_id,bonus_amount,bonus_transaction_id,tx_hash,actual_paid,credited_at' }
  ];
  const depositChecks = await Promise.all(depositTables.map(async ({ table, requiredColumns }) => ({
    table,
    ready: await supabaseAdmin.from(table).select(requiredColumns).limit(0)
      .then(({ error: tableError }) => !tableError).catch(() => false)
  })
  ));
  const payoutCheck = await supabaseAdmin.from('withdrawal_payouts')
    .select('id,transaction_id,network,status,tx_hash,signed_payload,next_attempt_at').limit(0)
    .then(({ error: tableError }) => !tableError).catch(() => false);
  const withdrawalEmailCodesCheck = await supabaseAdmin.from('withdrawal_email_codes')
    .select('user_id,code_hash,intent_hash,expires_at,attempts,sent_at').limit(0)
    .then(({ error: tableError }) => !tableError).catch(() => false);
  financialSchema.depositTablesReady = depositChecks.every(check => check.ready);
  financialSchema.payoutTableReady = payoutCheck;
  financialSchema.withdrawalEmailCodesReady = withdrawalEmailCodesCheck;
  financialSchema.missingDepositTables = depositChecks.filter(check => !check.ready).map(check => check.table);
  financialSchema.ready = financialSchema.depositTablesReady && financialSchema.payoutTableReady && financialSchema.withdrawalEmailCodesReady;
  return { configured: true, reachable: true, error: null, financialSchema };
}

module.exports = { supabase, supabaseAdmin, checkSupabaseConnection };
