require('dotenv').config({ path: '.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const requiredTables = [
  'users',
  'wallet_balances',
  'transactions',
  'financial_ledger',
  'sessions',
  'security_events',
  'vip_levels',
  'game_settings',
  'notifications',
  'support_tickets',
  'social_follows',
  'social_posts',
  'messages',
  'general_settings',
  'audit_logs'
];

const statements = [
  'create extension if not exists "uuid-ossp";',
  `create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;`,
  `create table if not exists public.vip_levels (
    id uuid primary key default uuid_generate_v4(),
    code text not null unique,
    name text not null,
    price numeric(18,4) not null default 0,
    tasks integer not null default 0,
    daily_profit numeric(18,4) not null default 0,
    monthly_profit numeric(18,4) not null default 0,
    yearly_profit numeric(18,4) not null default 0,
    badge_color text not null default 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );`,
  `create table if not exists public.game_settings (
    id uuid primary key default uuid_generate_v4(),
    key text not null unique default 'default',
    spin_min integer not null default 1,
    spin_max integer not null default 10,
    box_min integer not null default 5,
    box_max integer not null default 25,
    daily_game_reward_cap integer not null default 100,
    referrals_per_cycle integer not null default 25,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );`,
  `create table if not exists public.notifications (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null,
    broadcast_id uuid,
    title text not null,
    body text not null,
    type text not null default 'system',
    read_at timestamptz,
    created_at timestamptz not null default now()
  );`,
  `create table if not exists public.support_tickets (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null,
    subject text not null,
    message text not null,
    status text not null default 'open',
    admin_reply text default '',
    replied_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );`,
  `create table if not exists public.social_follows (
    id uuid primary key default uuid_generate_v4(),
    follower_id uuid not null,
    following_id uuid not null,
    created_at timestamptz not null default now(),
    unique(follower_id, following_id)
  );`,
  `create table if not exists public.social_posts (
    id uuid primary key default uuid_generate_v4(),
    author_id uuid,
    author_label text not null default 'OPERIX AI',
    content text not null,
    hashtags text[] not null default '{}',
    image_url text default '',
    is_official_ai boolean not null default false,
    source text not null default 'user',
    status text not null default 'visible',
    moderation_reason text default '',
    report_count integer not null default 0,
    reported_by uuid[] not null default '{}',
    saved_by uuid[] not null default '{}',
    liked_by uuid[] not null default '{}',
    like_count integer not null default 0,
    share_count integer not null default 0,
    is_pinned boolean not null default false,
    comments jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );`,
  `create table if not exists public.messages (
    id uuid primary key default uuid_generate_v4(),
    sender_id uuid not null,
    recipient_id uuid not null,
    body text not null,
    status text not null default 'visible',
    moderation_reason text default '',
    read_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );`,
  `create table if not exists public.general_settings (
    id uuid primary key default uuid_generate_v4(),
    key text not null unique,
    value jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );`,
  `create table if not exists public.audit_logs (
    id uuid primary key default uuid_generate_v4(),
    actor_id uuid,
    action text not null,
    entity text default '',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );`,
  `do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_vip_levels_updated_at') then
    create trigger set_vip_levels_updated_at before update on public.vip_levels
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_game_settings_updated_at') then
    create trigger set_game_settings_updated_at before update on public.game_settings
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_support_tickets_updated_at') then
    create trigger set_support_tickets_updated_at before update on public.support_tickets
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_social_posts_updated_at') then
    create trigger set_social_posts_updated_at before update on public.social_posts
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_messages_updated_at') then
    create trigger set_messages_updated_at before update on public.messages
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_general_settings_updated_at') then
    create trigger set_general_settings_updated_at before update on public.general_settings
    for each row execute function public.set_updated_at();
  end if;
end $$;`
];

async function executeSql(query) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/sql`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ query })
  });

  const text = await response.text();
  console.log('SQL status:', response.status, response.statusText);
  if (text && text.length < 500) console.log(text);
  if (!response.ok) {
    throw new Error(`Supabase SQL execution failed: ${response.status} :: ${text.slice(0, 500)}`);
  }
}

async function checkTables() {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/sql`;
  const tableList = requiredTables.map((t) => `'${t}'`).join(',');
  const query = `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${tableList}) order by table_name;`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ query })
  });

  const text = await response.text();
  console.log('Table check status:', response.status, response.statusText);
  console.log(text.slice(0, 2000));
  if (!response.ok) {
    throw new Error(`Table check failed: ${response.status} :: ${text.slice(0, 500)}`);
  }
}

async function main() {
  console.log('Submitting SQL in small batches to live Supabase project...');
  for (const statement of statements) {
    await executeSql(statement);
  }

  await checkTables();
  console.log('Schema submission completed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
