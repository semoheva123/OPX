-- OPERIX Supabase schema starter
-- This schema represents the critical finance, auth, and game tables needed before migrating the app.

create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'user' check (role in ('user','admin','financial_admin','support_admin','monitor')),
  email_verified boolean not null default false,
  is_banned boolean not null default false,
  tier_code text not null default 'A1',
  referral_code text,
  referred_by text,
  wallet_address text default '',
  kyc_status text not null default 'not_started' check (kyc_status in ('not_started','pending','verified','rejected')),
  two_factor_enabled boolean not null default false,
  two_factor_secret text,
  admin_two_factor_enabled boolean not null default false,
  admin_two_factor_secret text,
  asset_wallet numeric(18,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.wallet_balances (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  balance numeric(18,4) not null default 0,
  deposit_balance numeric(18,4) not null default 0,
  profit_balance numeric(18,4) not null default 0,
  total_deposits numeric(18,4) not null default 0,
  total_withdrawn numeric(18,4) not null default 0,
  usdt_balance numeric(18,4) not null default 0,
  opx_balance numeric(18,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.financial_ledger (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('deposit','withdraw','reward','staking_reward','referral_commission','upgrade_deduction','token_burn','vault_lock','vault_release','vault_early_release','vault_penalty','admin_adjustment')),
  currency text not null default 'USDT' check (currency in ('USDT','OPX')),
  amount numeric(18,4) not null default 0,
  fee_amount numeric(18,4) not null default 0,
  net_amount numeric(18,4) not null default 0,
  balance_before numeric(18,4) not null default 0,
  balance_after numeric(18,4) not null default 0,
  status text not null default 'approved' check (status in ('pending','approved','rejected')),
  source text not null default 'system',
  reference_id text,
  notes text default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('deposit','withdraw','reward','staking_reward','referral_commission','upgrade_deduction','token_burn','vault_lock','vault_release','vault_early_release','vault_penalty','admin_adjustment')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  amount numeric(18,4) not null default 0,
  gross_amount numeric(18,4) not null default 0,
  usdt_amount numeric(18,4) not null default 0,
  opx_amount numeric(18,4) not null default 0,
  fee_amount numeric(18,4) not null default 0,
  net_amount numeric(18,4) not null default 0,
  wallet_address text not null default '',
  tx_hash text,
  network text,
  risk_score integer default 0,
  risk_level text default 'low' check (risk_level in ('low','medium','high')),
  risk_flags jsonb not null default '[]'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  jti text not null,
  scope text default 'user',
  ip_address text,
  user_agent text,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.security_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete set null,
  event text not null,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vip_levels (
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
);

create table if not exists public.game_settings (
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
);

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  broadcast_id uuid,
  title text not null,
  body text not null,
  type text not null default 'system' check (type in ('system','transaction','security','support')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  admin_reply text default '',
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_follows (
  id uuid primary key default uuid_generate_v4(),
  follower_id uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(follower_id, following_id)
);

create table if not exists public.social_posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid references public.users(id) on delete set null,
  author_label text not null default 'OPERIX AI',
  content text not null,
  hashtags text[] not null default '{}',
  image_url text default '',
  is_official_ai boolean not null default false,
  source text not null default 'user' check (source in ('user','ai_generated')),
  status text not null default 'visible' check (status in ('visible','hidden','banned','removed')),
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
);

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  sender_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  status text not null default 'visible' check (status in ('visible','banned')),
  moderation_reason text default '',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.general_settings (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid,
  action text not null,
  entity text default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_user_type_created on public.transactions(user_id, type, created_at desc);
create index if not exists idx_ledger_user_type_created on public.financial_ledger(user_id, type, created_at desc);
create index if not exists idx_wallet_balances_user on public.wallet_balances(user_id);
create index if not exists idx_sessions_user_active on public.sessions(user_id, revoked_at, expires_at);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_support_tickets_user_updated on public.support_tickets(user_id, updated_at desc);
create index if not exists idx_social_posts_status_created on public.social_posts(status, created_at desc);
create index if not exists idx_messages_pair_created on public.messages(sender_id, recipient_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_users_updated_at'
  ) then
    create trigger set_users_updated_at
    before update on public.users
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_wallet_balances_updated_at'
  ) then
    create trigger set_wallet_balances_updated_at
    before update on public.wallet_balances
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_transactions_updated_at'
  ) then
    create trigger set_transactions_updated_at
    before update on public.transactions
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_vip_levels_updated_at'
  ) then
    create trigger set_vip_levels_updated_at
    before update on public.vip_levels
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_game_settings_updated_at'
  ) then
    create trigger set_game_settings_updated_at
    before update on public.game_settings
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_support_tickets_updated_at'
  ) then
    create trigger set_support_tickets_updated_at
    before update on public.support_tickets
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_social_posts_updated_at'
  ) then
    create trigger set_social_posts_updated_at
    before update on public.social_posts
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_messages_updated_at'
  ) then
    create trigger set_messages_updated_at
    before update on public.messages
    for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_general_settings_updated_at'
  ) then
    create trigger set_general_settings_updated_at
    before update on public.general_settings
    for each row execute function public.set_updated_at();
  end if;
end $$;

select table_name from information_schema.tables where table_schema = 'public' order by table_name;