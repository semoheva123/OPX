-- OPERIX Supabase schema starter
-- This schema represents the critical finance, auth, and game tables needed before migrating the app.

create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  username text,
  password_hash text not null,
  role text not null default 'user' check (role in ('user','admin','financial_admin','support_admin','monitor')),
  email_verified boolean not null default false,
  email_updates_opt_out boolean not null default false,
  is_banned boolean not null default false,
  tier_code text not null default 'A1',
  referral_code text,
  referred_by text,
    wallet_address text default '',
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

alter table public.users add column if not exists email_verification_token text;
alter table public.users add column if not exists email_updates_opt_out boolean not null default false;
alter table public.users add column if not exists email_verification_expire timestamptz;
alter table public.users add column if not exists is_official_platform boolean not null default false;
alter table public.users add column if not exists today_completed_tasks integer not null default 0;
alter table public.users add column if not exists reset_otp text;
alter table public.users add column if not exists reset_otp_expire timestamptz;
alter table public.users add column if not exists reset_otp_attempts integer not null default 0;
alter table public.users add column if not exists two_factor_code text;
alter table public.users add column if not exists two_factor_expire timestamptz;
alter table public.users add column if not exists admin_invite_token text;
alter table public.users add column if not exists admin_invite_expire timestamptz;
alter table public.users add column if not exists admin_invite_used boolean not null default false;
alter table public.users add column if not exists terms_accepted_at timestamptz;
alter table public.users add column if not exists game_cycles_granted integer not null default 0;
alter table public.users add column if not exists wheel_credits integer not null default 0;
alter table public.users add column if not exists mystery_box_credits integer not null default 0;
alter table public.users add column if not exists profile_image text not null default '';
alter table public.users add column if not exists cover_image text not null default '';
alter table public.users add column if not exists social_bio text not null default '';
alter table public.users add column if not exists push_subscription jsonb;
alter table public.users add column if not exists username text;
update public.users
set username = lower(trim(email))
where username is null or btrim(username) = '';
update public.users set username = lower(trim(username)) where username <> lower(trim(username));
alter table public.users drop constraint if exists users_username_format_check;
alter table public.users add constraint users_username_format_check check (username ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
create unique index if not exists users_username_lower_unique_idx on public.users (lower(username));
alter table public.users alter column username set not null;
create table if not exists public.referral_reward_awards (
  id uuid primary key default uuid_generate_v4(),
  referrer_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  level_number integer not null check (level_number between 1 and 3),
  tier_code text not null,
  amount numeric(18,4) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (referred_user_id, level_number)
);

create index if not exists referral_reward_awards_referrer_created_idx
  on public.referral_reward_awards (referrer_id, created_at desc);
create table if not exists public.wallet_balances (
  amount numeric(18,4) not null check (amount > 0),
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
  daily_tasks jsonb not null default '[]'::jsonb,
  daily_profit numeric(18,4) not null default 0,
  monthly_profit numeric(18,4) not null default 0,
  yearly_profit numeric(18,4) not null default 0,
  badge_color text not null default 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vip_levels add column if not exists daily_tasks jsonb not null default '[]'::jsonb;

create table if not exists public.game_settings (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique default 'default',
  spin_min integer not null default 1,
  spin_max integer not null default 10,
  box_min integer not null default 5,
  box_max integer not null default 25,
  daily_game_reward_cap integer not null default 100,
  referrals_per_cycle integer not null default 6,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

update public.game_settings set referrals_per_cycle = 6 where referrals_per_cycle = 25;

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
  author_label text not null default 'خدمة عملاء OPERIX',
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

create table if not exists public.broadcasts (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 500),
  audience_type text not null default 'all' check (audience_type in ('all','active','tier','role')),
  audience_value text not null default '',
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','sending','sent','failed')),
  recipient_count integer not null default 0,
  internal_sent integer not null default 0,
  push_sent integer not null default 0,
  push_failed integer not null default 0,
  read_count integer not null default 0,
  created_by uuid not null references public.users(id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_broadcasts (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.users(id) on delete restrict,
  subject text not null check (char_length(subject) between 1 and 150),
  body text not null check (char_length(body) between 1 and 5000),
  status text not null default 'queued' check (status in ('queued','sending','sent','partial','manual_review')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  unknown_count integer not null default 0 check (unknown_count >= 0),
  last_error text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.email_broadcast_recipients (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.email_broadcasts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  email text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','unknown','suppressed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(campaign_id, user_id),
  unique(campaign_id, email)
);

create table if not exists public.coupons (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  amount numeric(18,4) not null check (amount >= 0),
  max_uses integer not null default 1 check (max_uses >= 1),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  used_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coupon_redemptions (
  id uuid primary key default uuid_generate_v4(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(coupon_id, user_id)
);

create table if not exists public.cpa_lead_conversions (
  id uuid primary key default uuid_generate_v4(),
  lead_id text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id text not null default '',
  event_key text not null default '',
  payout_usd numeric(18,4) not null check (payout_usd >= 0),
  credited_gross numeric(18,4) not null check (credited_gross >= 0),
  usdt_amount numeric(18,4) not null check (usdt_amount >= 0),
  opx_amount numeric(18,4) not null check (opx_amount >= 0),
  status text not null default 'credited' check (status in ('credited','reversed')),
  credited_at timestamptz not null default now(),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investment_vault (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(18,4) not null check (amount >= 0.01),
  duration_days integer not null check (duration_days in (90,180,365)),
  expected_return_rate numeric(7,4) not null default 0 check (expected_return_rate between 0 and 100),
  expected_profit numeric(18,4) not null default 0 check (expected_profit >= 0),
  start_date timestamptz not null default now(),
  maturity_date timestamptz not null,
  incentive_amount numeric(18,4) not null default 0 check (incentive_amount >= 0),
  incentive_status text not null default 'pending' check (incentive_status in ('pending','approved','none')),
  penalty_amount numeric(18,4) not null default 0 check (penalty_amount >= 0),
  status text not null default 'active' check (status in ('active','matured','claimed','emergency_released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investment_vault_contracts (
  id uuid primary key default uuid_generate_v4(),
  duration_days integer not null unique check (duration_days in (90,180,365)),
  expected_return_rate numeric(7,4) not null check (expected_return_rate between 0 and 100),
  enabled boolean not null default true,
  label text not null default '' check (char_length(label) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.operix_vault_create_atomic(
  p_amount numeric,
  p_duration_days integer,
  p_expected_return_rate numeric,
  p_expected_profit numeric,
  p_maturity_date timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row wallet_balances%rowtype;
  vault_row investment_vault%rowtype;
  lock_tx transactions%rowtype;
  before_balance numeric;
  calculated_profit numeric;
begin
  if p_amount is null or p_amount < 10 then raise exception using errcode = 'P0001', message = 'INVALID_VAULT_AMOUNT'; end if;
  if p_duration_days not in (90, 180, 365) then raise exception using errcode = 'P0001', message = 'INVALID_VAULT_DURATION'; end if;
  if p_expected_return_rate is null or p_expected_return_rate < 0 or p_expected_return_rate > 100 then raise exception using errcode = 'P0001', message = 'INVALID_VAULT_RATE'; end if;
  calculated_profit := round(p_amount * p_expected_return_rate / 100, 4);
  if abs(calculated_profit - coalesce(p_expected_profit, calculated_profit)) > 0.0001 then raise exception using errcode = 'P0001', message = 'VAULT_PROFIT_MISMATCH'; end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if wallet_row.usdt_balance < p_amount or wallet_row.profit_balance < p_amount then raise exception using errcode = 'P0001', message = 'INSUFFICIENT_VAULT_BALANCE'; end if;
  before_balance := wallet_row.balance;
  update wallet_balances set
    usdt_balance = usdt_balance - p_amount,
    profit_balance = profit_balance - p_amount,
    balance = deposit_balance + profit_balance - p_amount,
    updated_at = now()
  where user_id = p_user_id;
  insert into investment_vault(user_id, amount, duration_days, expected_return_rate, expected_profit, incentive_amount, incentive_status, maturity_date)
  values(p_user_id, round(p_amount, 4), p_duration_days, p_expected_return_rate, calculated_profit, calculated_profit, 'approved', coalesce(p_maturity_date, now() + (p_duration_days || ' days')::interval))
  returning * into vault_row;
  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address)
  values(p_user_id, 'vault_lock', 'approved', p_amount, p_amount, p_amount, 'Investment Vault lock ' || vault_row.id::text)
  returning * into lock_tx;
  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'vault_lock', 'USDT', p_amount, p_amount, before_balance, before_balance - p_amount, 'approved', 'investment_vault_lock', lock_tx.id::text, jsonb_build_object('vaultId', vault_row.id, 'durationDays', p_duration_days, 'expectedProfit', calculated_profit));
  insert into audit_logs(action, entity, actor_id, metadata, created_at)
  values('vault_created', vault_row.id::text, p_user_id, jsonb_build_object('amount', vault_row.amount, 'durationDays', p_duration_days, 'expectedProfit', calculated_profit), now());
  return jsonb_build_object('vault', row_to_json(vault_row), 'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id));
end;
$$;

create or replace function public.operix_vault_claim_atomic(
  p_user_id uuid,
  p_vault_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  vault_row investment_vault%rowtype;
  wallet_row wallet_balances%rowtype;
  release_tx transactions%rowtype;
  incentive_value numeric;
  release_value numeric;
  before_balance numeric;
begin
  select * into vault_row from investment_vault where id = p_vault_id and user_id = p_user_id for update;
  if vault_row.id is null then raise exception using errcode = 'P0002', message = 'VAULT_NOT_FOUND'; end if;
  if vault_row.status <> 'active' then raise exception using errcode = 'P0001', message = 'VAULT_ALREADY_RELEASED'; end if;
  if now() < vault_row.maturity_date then raise exception using errcode = 'P0001', message = 'VAULT_NOT_MATURED'; end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  incentive_value := round(coalesce(vault_row.incentive_amount, vault_row.expected_profit, 0), 4);
  release_value := round(vault_row.amount + incentive_value, 4);
  before_balance := wallet_row.balance;
  update wallet_balances set
    usdt_balance = usdt_balance + release_value,
    profit_balance = profit_balance + incentive_value,
    balance = deposit_balance + profit_balance + incentive_value,
    updated_at = now()
  where user_id = p_user_id;
  update investment_vault set status = 'claimed', updated_at = now() where id = vault_row.id;
  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address)
  values(p_user_id, 'vault_release', 'approved', release_value, release_value, release_value, 'Investment Vault release ' || vault_row.id::text)
  returning * into release_tx;
  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'vault_release', 'USDT', release_value, release_value, before_balance, before_balance + release_value, 'approved', 'investment_vault_claim', release_tx.id::text, jsonb_build_object('vaultId', vault_row.id, 'principal', vault_row.amount, 'incentiveAmount', incentive_value));
  insert into audit_logs(action, entity, actor_id, metadata, created_at)
  values('vault_claimed', vault_row.id::text, p_user_id, jsonb_build_object('releaseAmount', release_value, 'incentiveAmount', incentive_value), now());
  select * into vault_row from investment_vault where id = vault_row.id;
  return jsonb_build_object('vault', row_to_json(vault_row), 'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id), 'releaseAmount', release_value);
end;
$$;

create table if not exists public.stakings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(18,4) not null check (amount >= 0),
  duration_days integer not null check (duration_days in (7,15,30)),
  profit_rate numeric(9,6) not null,
  expected_profit numeric(18,4) not null check (expected_profit >= 0),
  start_date timestamptz not null default now(),
  end_date timestamptz not null,
  status text not null default 'active' check (status in ('active','completed','claimed')),
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
create unique index if not exists idx_transactions_deposit_tx_hash on public.transactions(tx_hash) where type = 'deposit' and tx_hash is not null;
create unique index if not exists idx_transactions_withdraw_idempotency on public.transactions(user_id, idempotency_key) where type = 'withdraw' and idempotency_key is not null;
create index if not exists idx_ledger_user_type_created on public.financial_ledger(user_id, type, created_at desc);
create index if not exists idx_wallet_balances_user on public.wallet_balances(user_id);
create index if not exists idx_sessions_user_active on public.sessions(user_id, revoked_at, expires_at);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_support_tickets_user_updated on public.support_tickets(user_id, updated_at desc);
create index if not exists idx_social_posts_status_created on public.social_posts(status, created_at desc);
create index if not exists idx_messages_pair_created on public.messages(sender_id, recipient_id, created_at desc);
create index if not exists idx_broadcasts_status_schedule on public.broadcasts(status, scheduled_at);
create index if not exists email_broadcasts_status_created_idx on public.email_broadcasts(status, created_at);
create index if not exists email_broadcast_recipients_queue_idx on public.email_broadcast_recipients(campaign_id, status, created_at);
create index if not exists idx_cpa_conversions_user on public.cpa_lead_conversions(user_id, created_at desc);
create index if not exists idx_investment_vault_user_status_maturity on public.investment_vault(user_id, status, maturity_date);
create index if not exists idx_stakings_user_status_end on public.stakings(user_id, status, end_date);

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

create or replace function public.operix_deposit_atomic(
  p_user_id uuid,
  p_amount numeric,
  p_network text,
  p_tx_hash text,
  p_wallet_address text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row wallet_balances%rowtype;
  transaction_row transactions%rowtype;
  before_balance numeric;
begin
  if exists (select 1 from transactions where user_id = p_user_id and type = 'deposit' and tx_hash = p_tx_hash) then
    raise exception using errcode = '23505', message = 'DUPLICATE_DEPOSIT';
  end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  before_balance := wallet_row.balance;
  update wallet_balances
  set deposit_balance = deposit_balance + p_amount,
      total_deposits = total_deposits + p_amount,
      balance = deposit_balance + p_amount + profit_balance,
      updated_at = now()
  where user_id = p_user_id;
  insert into transactions (user_id, type, status, amount, gross_amount, usdt_amount, wallet_address, tx_hash, network)
  values (p_user_id, 'deposit', 'approved', p_amount, p_amount, p_amount, p_wallet_address, p_tx_hash, p_network)
  returning * into transaction_row;
  insert into financial_ledger (user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values (p_user_id, 'deposit', 'USDT', p_amount, p_amount, before_balance, before_balance + p_amount, 'approved', 'blockchain_deposit', transaction_row.id::text, jsonb_build_object('network', p_network, 'txHash', p_tx_hash));
  return jsonb_build_object('transaction', row_to_json(transaction_row), 'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id));
end;
$$;

create or replace function public.operix_withdraw_atomic(
  p_user_id uuid,
  p_amount numeric,
  p_fee numeric,
  p_net_amount numeric,
  p_wallet_address text,
  p_image_url text,
  p_idempotency_key text,
  p_risk_score integer,
  p_risk_level text,
  p_risk_flags jsonb,
  p_network text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row wallet_balances%rowtype;
  transaction_row transactions%rowtype;
  before_balance numeric;
  normalized_network text := upper(trim(coalesce(p_network, '')));
begin
  if normalized_network not in ('TRC20', 'BEP20') then raise exception using errcode = 'P0001', message = 'INVALID_WITHDRAWAL_NETWORK'; end if;
  if p_idempotency_key is not null and exists (select 1 from transactions where user_id = p_user_id and type = 'withdraw' and idempotency_key = p_idempotency_key) then
    select * into transaction_row from transactions where user_id = p_user_id and type = 'withdraw' and idempotency_key = p_idempotency_key limit 1;
    return jsonb_build_object('duplicate', true, 'transaction', row_to_json(transaction_row));
  end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if wallet_row.profit_balance < p_amount then raise exception using errcode = 'P0001', message = 'INSUFFICIENT_PROFIT'; end if;
  before_balance := wallet_row.balance;
  update wallet_balances
  set profit_balance = profit_balance - p_amount,
      total_withdrawn = total_withdrawn + p_amount,
      balance = deposit_balance + profit_balance - p_amount,
      updated_at = now()
  where user_id = p_user_id;
  insert into transactions (user_id, type, status, amount, fee_amount, net_amount, wallet_address, network, idempotency_key, risk_score, risk_level, risk_flags)
  values (p_user_id, 'withdraw', 'pending', p_amount, p_fee, p_net_amount, p_wallet_address, normalized_network, nullif(p_idempotency_key, ''), p_risk_score, p_risk_level, coalesce(p_risk_flags, '[]'::jsonb))
  returning * into transaction_row;
  insert into financial_ledger (user_id, type, currency, amount, fee_amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values (p_user_id, 'withdraw', 'USDT', p_amount, p_fee, p_net_amount, before_balance, before_balance - p_amount, 'pending', 'withdrawal_request', transaction_row.id::text, jsonb_build_object('walletAddress', p_wallet_address, 'network', normalized_network, 'riskLevel', p_risk_level));
  return jsonb_build_object('duplicate', false, 'transaction', row_to_json(transaction_row), 'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id));
end;
$$;

create or replace function public.operix_upgrade_atomic(
  p_user_id uuid,
  p_expected_tier text,
  p_target_tier text,
  p_upgrade_cost numeric,
  p_usdt_amount numeric,
  p_opx_amount numeric,
  p_opx_value numeric,
  p_referrer_id uuid,
  p_referral_commission numeric,
  p_target_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row users%rowtype;
  wallet_row wallet_balances%rowtype;
  ref_wallet wallet_balances%rowtype;
  upgrade_row transactions%rowtype;
  before_balance numeric;
  target_level_number integer;
  referral_reward_amount numeric(18,4) := 0;
  referral_reward_awarded numeric(18,4) := 0;
  referrer_balance numeric(18,4) := 0;
  trusted_referrer_id uuid;
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  if user_row.tier_code is distinct from p_expected_tier then raise exception using errcode = 'P0001', message = 'TIER_CHANGED'; end if;
  select ranked.level_number into target_level_number
  from (
    select code, row_number() over (order by price asc, code asc)::integer as level_number
    from vip_levels
  ) ranked
  where ranked.code = p_target_tier;
  if target_level_number is null then raise exception using errcode = 'P0002', message = 'VIP_LEVEL_NOT_FOUND'; end if;
  referral_reward_amount := case target_level_number when 1 then 1 when 2 then 2 when 3 then 5 else 0 end;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if wallet_row.deposit_balance < p_usdt_amount then raise exception using errcode = 'P0001', message = 'INSUFFICIENT_DEPOSIT'; end if;
  before_balance := wallet_row.balance;
  update users set tier_code = p_target_tier, updated_at = now() where id = p_user_id;
  update wallet_balances set deposit_balance = deposit_balance - p_usdt_amount, opx_balance = opx_balance - p_opx_amount, balance = deposit_balance - p_usdt_amount + profit_balance, updated_at = now() where user_id = p_user_id;
  insert into transactions(user_id,type,status,amount,gross_amount,usdt_amount,opx_amount,wallet_address) values(p_user_id,'upgrade_deduction','approved',p_upgrade_cost,p_upgrade_cost,p_usdt_amount,p_opx_amount,'Upgrade to ' || p_target_name) returning * into upgrade_row;
  if p_opx_amount > 0 then
    insert into transactions(user_id,type,status,amount,gross_amount,opx_amount,wallet_address) values(p_user_id,'token_burn','approved',p_opx_value,p_opx_value,p_opx_amount,'Burn OPX for ' || p_target_name);
  end if;
  insert into financial_ledger(user_id,type,currency,amount,net_amount,balance_before,balance_after,status,source,reference_id) values(p_user_id,'upgrade_deduction','USDT',p_upgrade_cost,p_usdt_amount,before_balance,before_balance-p_usdt_amount,'approved','tier_upgrade',upgrade_row.id::text);
  if p_referrer_id is not null and user_row.referred_by is not null and p_referrer_id <> p_user_id then
    select id into trusted_referrer_id
    from users
    where id = p_referrer_id and upper(trim(referral_code)) = upper(trim(user_row.referred_by))
    for update;
  end if;
  if trusted_referrer_id is not null and referral_reward_amount > 0 and p_upgrade_cost > 0 then
    select * into ref_wallet from wallet_balances where user_id = trusted_referrer_id for update;
    if ref_wallet.id is not null then
      insert into referral_reward_awards(referrer_id,referred_user_id,level_number,tier_code,amount)
      values(trusted_referrer_id,p_user_id,target_level_number,p_target_tier,referral_reward_amount)
    on conflict (referred_user_id,level_number) do nothing
      returning amount into referral_reward_awarded;
      if referral_reward_awarded is not null then
        update wallet_balances
        set profit_balance = profit_balance + referral_reward_awarded,
            balance = deposit_balance + profit_balance + referral_reward_awarded,
            usdt_balance = deposit_balance + profit_balance + referral_reward_awarded,
            updated_at = now()
        where user_id = trusted_referrer_id
        returning balance into referrer_balance;
        insert into transactions(user_id,type,status,amount,gross_amount,usdt_amount,wallet_address)
        values(trusted_referrer_id,'referral_commission','approved',referral_reward_awarded,referral_reward_awarded,referral_reward_awarded,'Referral activation reward from ' || user_row.email);
        insert into financial_ledger(user_id,type,currency,amount,net_amount,balance_before,balance_after,status,source,reference_id,notes)
        values(trusted_referrer_id,'referral_commission','USDT',referral_reward_awarded,referral_reward_awarded,ref_wallet.balance,referrer_balance,'approved','referral_tier_activation',upgrade_row.id::text,'Tier ' || target_level_number::text || ' referral activation reward');
        insert into notifications(user_id,title,body,type)
        values(trusted_referrer_id,'مكافأة إحالة جديدة','تمت إضافة $' || to_char(referral_reward_awarded,'FM999999990.00') || ' إلى رصيد أرباحك بعد تفعيل إحالتك المباشرة للمستوى ' || target_level_number::text || '.','transaction');
      else
        select balance into referrer_balance from wallet_balances where user_id = trusted_referrer_id;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'user',(select row_to_json(u) from users u where u.id=p_user_id),
    'wallet',(select row_to_json(w) from wallet_balances w where w.user_id=p_user_id),
    'referralRewardAwarded',coalesce(referral_reward_awarded,0),
    'referrerBalance',coalesce(referrer_balance,0)
  );
end;
$$;

revoke execute on function public.operix_upgrade_atomic(uuid,text,text,numeric,numeric,numeric,numeric,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.operix_upgrade_atomic(uuid,text,text,numeric,numeric,numeric,numeric,uuid,numeric,text) to service_role;

create or replace function public.operix_admin_adjust_balance_atomic(
  p_user_id uuid,
  p_deposit_balance numeric,
  p_profit_balance numeric,
  p_balance numeric,
  p_admin_user_id uuid,
  p_reason text default 'admin_adjustment'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row users%rowtype;
  wallet_row wallet_balances%rowtype;
  before_balance numeric;
  delta_amount numeric := 0;
  tx_id uuid;
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;

  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;

  before_balance := wallet_row.balance;

  if p_deposit_balance is not null then
    wallet_row.deposit_balance := p_deposit_balance;
  end if;

  if p_profit_balance is not null then
    wallet_row.profit_balance := p_profit_balance;
  end if;

  if p_balance is not null and (p_deposit_balance is null and p_profit_balance is null) then
    wallet_row.profit_balance := greatest(p_balance - wallet_row.deposit_balance, 0);
  end if;

  if p_balance is not null and (p_deposit_balance is not null or p_profit_balance is not null) then
    wallet_row.profit_balance := greatest(p_balance - wallet_row.deposit_balance, 0);
  end if;

  wallet_row.balance := wallet_row.deposit_balance + wallet_row.profit_balance;
  update wallet_balances
    set deposit_balance = wallet_row.deposit_balance,
        profit_balance = wallet_row.profit_balance,
        balance = wallet_row.balance,
        updated_at = now()
    where user_id = p_user_id;

  delta_amount := wallet_row.balance - before_balance;
  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address, created_at)
  values(p_user_id, 'admin_adjustment', 'approved', abs(delta_amount), abs(delta_amount), abs(delta_amount), 'ADMIN_ADJUSTMENT', now())
  returning id into tx_id;

  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'admin_adjustment', 'USDT', abs(delta_amount), delta_amount, before_balance, wallet_row.balance, 'approved', 'admin_balance_adjustment', tx_id::text, jsonb_build_object('reason', coalesce(p_reason, 'admin_adjustment'), 'adminUserId', p_admin_user_id));

  return jsonb_build_object(
    'user', (select row_to_json(u) from users u where u.id = p_user_id),
    'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id),
    'transaction', (select row_to_json(t) from transactions t where t.id = tx_id)
  );
end;
$$;

create or replace function public.operix_admin_transaction_action_atomic(
  p_transaction_id uuid,
  p_action text,
  p_admin_user_id uuid,
  p_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tx transactions%rowtype;
  wallet_row wallet_balances%rowtype;
  affected_user_id uuid;
  tx_status text;
begin
  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception using errcode = 'P0001', message = 'INVALID_ACTION';
  end if;

  select * into tx from transactions where id = p_transaction_id for update;
  if tx.id is null then
    raise exception using errcode = 'P0002', message = 'TRANSACTION_NOT_FOUND';
  end if;

  if tx.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'PROCESSED';
  end if;

  affected_user_id := tx.user_id;
  select * into wallet_row from wallet_balances where user_id = affected_user_id for update;
  if wallet_row.id is null then
    raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND';
  end if;

  if p_action = 'approve' and tx.type = 'deposit' then
    wallet_row.deposit_balance := wallet_row.deposit_balance + tx.amount;
    wallet_row.total_deposits := wallet_row.total_deposits + tx.amount;
    wallet_row.balance := wallet_row.deposit_balance + wallet_row.profit_balance;
    update wallet_balances set deposit_balance = wallet_row.deposit_balance, total_deposits = wallet_row.total_deposits, balance = wallet_row.balance, updated_at = now() where user_id = affected_user_id;
    update transactions set status = 'approved', updated_at = now() where id = p_transaction_id;
  elsif p_action = 'reject' and tx.type = 'withdraw' then
    wallet_row.profit_balance := wallet_row.profit_balance + tx.amount;
    wallet_row.total_withdrawn := greatest(wallet_row.total_withdrawn - tx.amount, 0);
    wallet_row.balance := wallet_row.deposit_balance + wallet_row.profit_balance;
    update wallet_balances set profit_balance = wallet_row.profit_balance, total_withdrawn = wallet_row.total_withdrawn, balance = wallet_row.balance, updated_at = now() where user_id = affected_user_id;
    update transactions set status = 'rejected', updated_at = now() where id = p_transaction_id;
  else
    update transactions set status = case when p_action = 'approve' then 'approved' else 'rejected' end, updated_at = now() where id = p_transaction_id;
  end if;

  select * into tx from transactions where id = p_transaction_id;
  insert into audit_logs(action, entity, actor_id, metadata, created_at)
  values('transaction_' || p_action, tx.id::text, p_admin_user_id, jsonb_build_object('type', tx.type, 'amount', tx.amount, 'note', p_note), now());

  return jsonb_build_object(
    'transaction', (select row_to_json(t) from transactions t where t.id = p_transaction_id),
    'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = affected_user_id)
  );
end;
$$;

create or replace function public.operix_admin_emergency_vault_release_atomic(
  p_vault_id uuid,
  p_admin_user_id uuid,
  p_owner_user_id uuid,
  p_penalty_rate numeric default 0.30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  vault_row investment_vault%rowtype;
  user_wallet wallet_balances%rowtype;
  owner_wallet wallet_balances%rowtype;
  user_amount_value numeric;
  penalty_amount_value numeric;
  user_before numeric;
  owner_before numeric;
  release_tx_id uuid;
  penalty_tx_id uuid;
begin
  if p_penalty_rate is null or p_penalty_rate <= 0 or p_penalty_rate >= 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_PENALTY_RATE';
  end if;
  if p_owner_user_id is null then
    raise exception using errcode = 'P0001', message = 'VAULT_OWNER_NOT_CONFIGURED';
  end if;

  select * into vault_row from investment_vault where id = p_vault_id for update;
  if vault_row.id is null then raise exception using errcode = 'P0002', message = 'VAULT_NOT_FOUND'; end if;
  if vault_row.status <> 'active' then raise exception using errcode = 'P0001', message = 'VAULT_ALREADY_RELEASED'; end if;
  if vault_row.user_id = p_owner_user_id then raise exception using errcode = 'P0001', message = 'VAULT_OWNER_SAME_AS_USER'; end if;

  select * into user_wallet from wallet_balances where user_id = vault_row.user_id for update;
  if user_wallet.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  select * into owner_wallet from wallet_balances where user_id = p_owner_user_id for update;
  if owner_wallet.id is null then raise exception using errcode = 'P0002', message = 'OWNER_WALLET_NOT_FOUND'; end if;

  penalty_amount_value := round(vault_row.amount * p_penalty_rate, 4);
  user_amount_value := round(vault_row.amount - penalty_amount_value, 4);
  user_before := user_wallet.balance;
  owner_before := owner_wallet.balance;

  update wallet_balances set
    profit_balance = profit_balance + user_amount_value,
    usdt_balance = usdt_balance + user_amount_value,
    balance = deposit_balance + profit_balance + user_amount_value,
    updated_at = now()
  where user_id = vault_row.user_id;

  update wallet_balances set
    profit_balance = profit_balance + penalty_amount_value,
    usdt_balance = usdt_balance + penalty_amount_value,
    balance = deposit_balance + profit_balance + penalty_amount_value,
    updated_at = now()
  where user_id = p_owner_user_id;

  update investment_vault set status = 'emergency_released', penalty_amount = penalty_amount_value, updated_at = now() where id = p_vault_id;

  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address)
  values(vault_row.user_id, 'vault_early_release', 'approved', user_amount_value, vault_row.amount, user_amount_value, 'Emergency vault release') returning id into release_tx_id;
  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address)
  values(p_owner_user_id, 'vault_penalty', 'approved', penalty_amount_value, penalty_amount_value, penalty_amount_value, 'Vault emergency release penalty') returning id into penalty_tx_id;

  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(vault_row.user_id, 'vault_early_release', 'USDT', user_amount_value, user_amount_value, user_before, user_before + user_amount_value, 'approved', 'admin_emergency_vault_release', release_tx_id::text, jsonb_build_object('vaultId', p_vault_id, 'penaltyAmount', penalty_amount_value, 'adminUserId', p_admin_user_id));
  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_owner_user_id, 'vault_penalty', 'USDT', penalty_amount_value, penalty_amount_value, owner_before, owner_before + penalty_amount_value, 'approved', 'admin_emergency_vault_release', penalty_tx_id::text, jsonb_build_object('vaultId', p_vault_id, 'beneficiaryUserId', vault_row.user_id, 'adminUserId', p_admin_user_id));
  insert into audit_logs(action, entity, actor_id, metadata, created_at)
  values('vault_emergency_release', p_vault_id::text, p_admin_user_id, jsonb_build_object('userId', vault_row.user_id, 'ownerUserId', p_owner_user_id, 'returnedAmount', user_amount_value, 'penaltyAmount', penalty_amount_value), now());

  return jsonb_build_object('vault', (select row_to_json(v) from investment_vault v where v.id = p_vault_id), 'userAmount', user_amount_value, 'penaltyAmount', penalty_amount_value);
end;
$$;

create or replace function public.operix_daily_task_atomic(
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row users%rowtype;
  wallet_row wallet_balances%rowtype;
  level_row vip_levels%rowtype;
  max_tasks integer;
  gross_reward numeric;
  usdt_reward numeric;
  opx_reward numeric;
  balance_before numeric;
  transaction_id uuid;
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;

  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if lower(coalesce(user_row.email, '')) <> 'official@operix.website' and wallet_row.total_deposits <= 0 then raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE'; end if;

  select * into level_row from vip_levels where code = user_row.tier_code;
  if level_row.id is null then raise exception using errcode = 'P0002', message = 'VIP_LEVEL_NOT_FOUND'; end if;
  max_tasks := greatest(coalesce(level_row.tasks, 1) - 1, 0);
  if user_row.today_completed_tasks >= max_tasks then raise exception using errcode = 'P0001', message = 'DAILY_TASK_LIMIT_REACHED'; end if;

  if max_tasks < 1 then raise exception using errcode = 'P0001', message = 'NO_PAID_TASKS_CONFIGURED'; end if;
  gross_reward := round(coalesce(level_row.daily_profit, 2.5) / max_tasks, 4);
  opx_reward := round(
    least(
      coalesce(level_row.daily_profit, 2.5),
      case upper(level_row.code)
        when 'A1' then 0.05
        when 'A2' then 0.10
        when 'A3' then 0.15
        else 0
      end
    ) / max_tasks,
    4
  );
  usdt_reward := round(gross_reward - opx_reward, 4);
  balance_before := wallet_row.balance;

  update users
  set asset_wallet = round(coalesce(asset_wallet, 0) + gross_reward, 4),
      today_completed_tasks = today_completed_tasks + 1,
      updated_at = now()
  where id = p_user_id;

  update wallet_balances
  set profit_balance = round(profit_balance + usdt_reward, 4),
      opx_balance = round(opx_balance + opx_reward, 4),
      usdt_balance = round(deposit_balance + profit_balance + usdt_reward, 4),
      balance = round(deposit_balance + profit_balance + usdt_reward, 4),
      updated_at = now()
  where user_id = p_user_id;

  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, opx_amount, wallet_address)
  values(p_user_id, 'reward', 'approved', gross_reward, gross_reward, usdt_reward, opx_reward, 'Daily Task Reward')
  returning id into transaction_id;

  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'reward', 'USDT', usdt_reward, usdt_reward, balance_before, balance_before + usdt_reward, 'approved', 'daily_task', transaction_id::text, jsonb_build_object('grossAmount', gross_reward, 'opxAmount', opx_reward));

  return jsonb_build_object(
    'userId', p_user_id,
    'assetWallet', (select asset_wallet from users where id = p_user_id),
    'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id),
    'completed', (select today_completed_tasks from users where id = p_user_id),
    'grossAmount', gross_reward,
    'usdtAmount', usdt_reward,
    'opxAmount', opx_reward,
    'transactionId', transaction_id
  );
end;
$$;

create table if not exists public.daily_task_completions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_key text not null,
  task_date date not null default current_date,
  gross_amount numeric(18,4) not null default 0,
  usdt_amount numeric(18,4) not null default 0,
  opx_amount numeric(18,4) not null default 0,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id, task_date, task_key)
);

create table if not exists public.daily_task_entities (
  id uuid primary key default uuid_generate_v4(),
  snapshot_date date not null,
  entity_key text not null,
  category text not null check (category in ('technology', 'ai', 'crypto', 'trading', 'finance')),
  name text not null,
  summary text not null,
  image_url text not null default '',
  source text not null,
  created_at timestamptz not null default now(),
  unique(snapshot_date, entity_key)
);

create index if not exists daily_task_entities_snapshot_category_idx on public.daily_task_entities(snapshot_date, category);
alter table public.daily_task_entities enable row level security;
revoke all on table public.daily_task_entities from public, anon, authenticated;
grant all on table public.daily_task_entities to service_role;

create table if not exists public.daily_task_assignments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  tier_code text not null,
  task_date date not null,
  task_number integer not null check (task_number >= 2),
  category text not null check (category in ('technology', 'ai', 'crypto', 'trading', 'finance')),
  entity_key text not null,
  entity_name text not null,
  summary text not null,
  image_url text not null default '',
  source text not null,
  allowed_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(user_id, tier_code, task_date, task_number),
  unique(user_id, task_date, entity_key)
);

create index if not exists daily_task_assignments_user_recent_idx on public.daily_task_assignments(user_id, task_date desc);
alter table public.daily_task_assignments enable row level security;
revoke all on table public.daily_task_assignments from public, anon, authenticated;
grant all on table public.daily_task_assignments to service_role;

create table if not exists public.daily_task_submissions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_key text not null,
  task_date date not null default current_date,
  assignment_id uuid references public.daily_task_assignments(id) on delete set null,
  entity_key text not null default '',
  target_category text not null check (target_category in ('technology', 'ai', 'crypto', 'trading', 'finance')),
  target_name text not null,
  rating integer not null check (rating between 1 and 5),
  selected_tag text not null default '',
  feedback text not null default '',
  strengths text not null,
  concerns text not null,
  evidence_url text not null,
  created_at timestamptz not null default now(),
  unique(user_id, task_key, task_date)
);

alter table public.daily_task_submissions add column if not exists assignment_id uuid references public.daily_task_assignments(id) on delete set null;
alter table public.daily_task_submissions add column if not exists entity_key text not null default '';
alter table public.daily_task_submissions add column if not exists selected_tag text not null default '';
alter table public.daily_task_submissions add column if not exists feedback text not null default '';

create index if not exists daily_task_submissions_user_date_idx on public.daily_task_submissions(user_id, task_date);
alter table public.daily_task_submissions enable row level security;
revoke all on table public.daily_task_submissions from public, anon, authenticated;
grant all on table public.daily_task_submissions to service_role;

create index if not exists daily_task_completions_user_date_idx on public.daily_task_completions(user_id, task_date);

create or replace function public.operix_enforce_daily_task_sequence_and_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_tier text;
  task_number integer;
  previous_task_key text;
  plan_started_at timestamptz;
begin
  select tier_code into current_tier from public.users where id = new.user_id for update;
  if current_tier is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  if new.task_key = current_tier || '-community' then
    raise exception using errcode = 'P0001', message = 'OPTIONAL_TASK_NO_REWARD';
  elsif new.task_key ~ ('^' || current_tier || '-task-[0-9]+$') then
    task_number := substring(new.task_key from '[0-9]+$')::integer;
  else
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY';
  end if;
  if task_number < 2 then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;
  if task_number > 2 then
    previous_task_key := current_tier || '-task-' || lpad((task_number - 1)::text, 2, '0');
    if not exists (
      select 1 from public.daily_task_completions
      where user_id = new.user_id and task_date = new.task_date and task_key = previous_task_key
    ) then raise exception using errcode = 'P0001', message = 'TASK_SEQUENCE_REQUIRED'; end if;
    select min(created_at) into plan_started_at from public.daily_task_assignments
      where user_id = new.user_id and tier_code = current_tier and task_date = new.task_date;
    if plan_started_at is null or plan_started_at + ((task_number - 2) * interval '2 hours') > clock_timestamp() then
      raise exception using errcode = 'P0001', message = 'TASK_COOLDOWN_ACTIVE';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists daily_task_sequence_and_cooldown on public.daily_task_completions;
create trigger daily_task_sequence_and_cooldown before insert on public.daily_task_completions
for each row execute function public.operix_enforce_daily_task_sequence_and_cooldown();

create or replace function public.operix_daily_task_complete_atomic(
  p_user_id uuid,
  p_task_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row users%rowtype;
  wallet_row wallet_balances%rowtype;
  level_row vip_levels%rowtype;
  assignment_row daily_task_assignments%rowtype;
  max_tasks integer;
  requested_task_number integer;
  completed_count integer;
  gross_reward numeric;
  usdt_reward numeric;
  opx_reward numeric;
  balance_before numeric;
  total_daily_reward numeric;
  completion_id uuid;
  reward_transaction_id uuid;
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if lower(coalesce(user_row.email, '')) <> 'official@operix.website' and wallet_row.total_deposits <= 0 then raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE'; end if;

  select * into level_row from vip_levels where code = user_row.tier_code;
  if level_row.id is null then raise exception using errcode = 'P0002', message = 'VIP_LEVEL_NOT_FOUND'; end if;
  max_tasks := greatest(level_row.tasks, 1);
  if p_task_key = (user_row.tier_code || '-community') then
    raise exception using errcode = 'P0001', message = 'OPTIONAL_TASK_NO_REWARD';
  elsif p_task_key ~ ('^' || user_row.tier_code || '-task-[0-9]+$') then
    requested_task_number := substring(p_task_key from '[0-9]+$')::integer;
  else
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY';
  end if;
  if requested_task_number < 2 or requested_task_number > max_tasks + 1 then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;

  if requested_task_number > 1 then
    select * into assignment_row
    from daily_task_assignments assignment
    where assignment.user_id = p_user_id
      and assignment.tier_code = user_row.tier_code
      and assignment.task_date = current_date
      and assignment.task_number = requested_task_number;
    if assignment_row.id is null then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;
    if not exists (
      select 1 from daily_task_submissions submission
      where submission.user_id = p_user_id
        and submission.task_key = p_task_key
        and submission.task_date = current_date
        and submission.assignment_id = assignment_row.id
        and submission.entity_key = assignment_row.entity_key
        and submission.target_category = assignment_row.category
        and submission.target_name = assignment_row.entity_name
        and submission.selected_tag = any(assignment_row.allowed_tags)
        and submission.rating between 1 and 5
    ) then raise exception using errcode = 'P0001', message = 'EVALUATION_REQUIRED'; end if;
  end if;

  gross_reward := round(coalesce(level_row.daily_profit, 2.5) / max_tasks, 4);
  opx_reward := round(
    least(
      coalesce(level_row.daily_profit, 2.5),
      case upper(level_row.code)
        when 'A1' then 0.05
        when 'A2' then 0.10
        when 'A3' then 0.15
        else 0
      end
    ) / max_tasks,
    4
  );
  usdt_reward := round(gross_reward - opx_reward, 4);
  balance_before := wallet_row.balance;
  select coalesce(sum(gross_amount), 0) into total_daily_reward
  from daily_task_completions
  where user_id = p_user_id and task_date = current_date;
  if total_daily_reward + gross_reward > coalesce(level_row.daily_profit, 0) then
    raise exception using errcode = 'P0001', message = 'DAILY_CAP_REACHED';
  end if;

  insert into daily_task_completions(user_id, task_key, task_date, gross_amount, usdt_amount, opx_amount)
  values(p_user_id, p_task_key, current_date, gross_reward, usdt_reward, opx_reward)
  on conflict (user_id, task_date, task_key) do nothing
  returning id into completion_id;
  if completion_id is null then raise exception using errcode = 'P0001', message = 'TASK_ALREADY_COMPLETED'; end if;

  update users
  set asset_wallet = round(coalesce(asset_wallet, 0) + gross_reward, 4), updated_at = now()
  where id = p_user_id;
  update wallet_balances
  set profit_balance = round(profit_balance + usdt_reward, 4),
      opx_balance = round(opx_balance + opx_reward, 4),
      usdt_balance = round(deposit_balance + profit_balance + usdt_reward, 4),
      balance = round(deposit_balance + profit_balance + usdt_reward, 4),
      updated_at = now()
  where user_id = p_user_id;

  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, opx_amount, wallet_address)
  values(p_user_id, 'reward', 'approved', gross_reward, gross_reward, usdt_reward, opx_reward, 'Daily Task ' || p_task_key)
  returning id into reward_transaction_id;
  update daily_task_completions set transaction_id = reward_transaction_id where id = completion_id;
  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'reward', 'USDT', usdt_reward, usdt_reward, balance_before, balance_before + usdt_reward, 'approved', 'daily_task', reward_transaction_id::text, jsonb_build_object('taskKey', p_task_key, 'grossAmount', gross_reward, 'opxAmount', opx_reward));

  select count(*) into completed_count from daily_task_completions
  where user_id = p_user_id and task_date = current_date
    and task_key ~ ('^' || user_row.tier_code || '-task-[0-9]+$');
  update users set today_completed_tasks = completed_count, updated_at = now() where id = p_user_id;
  return jsonb_build_object('taskKey', p_task_key, 'completed', completed_count, 'taskLimit', max_tasks, 'assetWallet', (select asset_wallet from users where id = p_user_id), 'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id), 'grossAmount', gross_reward, 'usdtAmount', usdt_reward, 'opxAmount', opx_reward, 'transactionId', reward_transaction_id);
end;
$$;

revoke all on function public.operix_daily_task_atomic(uuid) from public, anon, authenticated;
revoke all on function public.operix_daily_task_complete_atomic(uuid, text) from public, anon, authenticated;
grant execute on function public.operix_daily_task_complete_atomic(uuid, text) to service_role;

alter table if exists public.users add column if not exists wallet_network text;

select table_name from information_schema.tables where table_schema = 'public' order by table_name;