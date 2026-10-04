const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing Supabase env vars: ${missing.join(', ')}`);
  process.exit(1);
}

async function main() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const checks = [
    'users', 'wallet_balances', 'transactions', 'financial_ledger', 'sessions', 'security_events',
    'vip_levels', 'game_settings', 'daily_task_completions', 'daily_task_entities',
    'daily_task_assignments', 'daily_task_submissions', 'referral_reward_awards', 'milestone_reward_awards',
    'tron_deposit_addresses', 'tron_deposit_address_sequences', 'tron_deposit_events', 'withdrawal_payouts'
  ];
  const results = [];

  for (const table of checks) {
    const { data, error } = await client.from(table).select('id').limit(1);
    if (error) {
      results.push({ table, ok: false, error: error.message });
    } else {
      results.push({ table, ok: true, rows: data?.length ?? 0 });
    }
  }

  const failed = results.filter((item) => !item.ok);
  if (failed.length) {
    console.error(JSON.stringify({ status: 'not_ready', failed }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ status: 'ready', mode: process.env.DATABASE_MODE || 'hybrid', tables: results }, null, 2));
}

main().catch((error) => {
  console.error('Supabase readiness check failed:', error.message);
  process.exit(1);
});
