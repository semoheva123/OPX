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

alter table public.users add column if not exists email_verification_token text;
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
alter table public.users add column if not exists kyc_full_name text not null default '';
alter table public.users add column if not exists kyc_document_type text not null default '';
alter table public.users add column if not exists kyc_document_number text not null default '';
alter table public.users add column if not exists kyc_document_url text not null default '';
alter table public.users add column if not exists kyc_country text not null default '';
alter table public.users add column if not exists kyc_submitted_at timestamptz;
alter table public.users add column if not exists kyc_reviewed_at timestamptz;
alter table public.users add column if not exists kyc_reviewed_by uuid references public.users(id) on delete set null;
alter table public.users add column if not exists kyc_notes text not null default '';
alter table public.users add column if not exists kyc_reason text not null default '';

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
  p_risk_flags jsonb
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
  insert into transactions (user_id, type, status, amount, fee_amount, net_amount, wallet_address, idempotency_key, risk_score, risk_level, risk_flags)
  values (p_user_id, 'withdraw', 'pending', p_amount, p_fee, p_net_amount, p_wallet_address, nullif(p_idempotency_key, ''), p_risk_score, p_risk_level, coalesce(p_risk_flags, '[]'::jsonb))
  returning * into transaction_row;
  insert into financial_ledger (user_id, type, currency, amount, fee_amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values (p_user_id, 'withdraw', 'USDT', p_amount, p_fee, p_net_amount, before_balance, before_balance - p_amount, 'pending', 'withdrawal_request', transaction_row.id::text, jsonb_build_object('walletAddress', p_wallet_address, 'riskLevel', p_risk_level));
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
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  if user_row.tier_code is distinct from p_expected_tier then raise exception using errcode = 'P0001', message = 'TIER_CHANGED'; end if;
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
  if p_referrer_id is not null and p_referral_commission > 0 then
    select * into ref_wallet from wallet_balances where user_id = p_referrer_id for update;
    if ref_wallet.id is not null then
      update wallet_balances set profit_balance = profit_balance + (p_referral_commission * 0.7), opx_balance = opx_balance + (p_referral_commission * 0.3), balance = deposit_balance + profit_balance + (p_referral_commission * 0.7), updated_at = now() where user_id = p_referrer_id;
      insert into transactions(user_id,type,status,amount,gross_amount,usdt_amount,opx_amount,wallet_address) values(p_referrer_id,'referral_commission','approved',p_referral_commission,p_referral_commission,p_referral_commission*0.7,p_referral_commission*0.3,'Commission from ' || user_row.email);
    end if;
  end if;
  return jsonb_build_object('user',(select row_to_json(u) from users u where u.id=p_user_id),'wallet',(select row_to_json(w) from wallet_balances w where w.user_id=p_user_id));
end;
$$;

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
  delta_amount numeric := 0;
  tx_id uuid;
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;

  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;

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

  delta_amount := wallet_row.balance - (coalesce(wallet_row.balance, 0) - wallet_row.balance);
  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address, created_at)
  values(p_user_id, 'admin_adjustment', 'approved', abs(delta_amount), abs(delta_amount), abs(delta_amount), 'ADMIN_ADJUSTMENT', now())
  returning id into tx_id;

  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'admin_adjustment', 'USDT', abs(delta_amount), abs(delta_amount), wallet_row.balance, wallet_row.balance, 'approved', 'admin_balance_adjustment', tx_id::text, jsonb_build_object('reason', coalesce(p_reason, 'admin_adjustment'), 'adminUserId', p_admin_user_id));

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

select table_name from information_schema.tables where table_schema = 'public' order by table_name;