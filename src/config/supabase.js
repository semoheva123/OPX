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
  if (!supabaseAdmin) return { configured: false, reachable: false };
  const { error } = await supabaseAdmin.from('users').select('id').limit(1);
  return { configured: true, reachable: !error, error: error ? error.message : null };
}

module.exports = { supabase, supabaseAdmin, checkSupabaseConnection };
