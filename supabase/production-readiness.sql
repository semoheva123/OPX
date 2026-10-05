begin;

-- Add the per-level task configuration field missing from the live project.
alter table public.vip_levels
  add column if not exists daily_tasks jsonb not null default '[]'::jsonb;

create table if not exists public.daily_task_completions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_key text not null,
  task_date date not null default (now() at time zone 'UTC')::date,
  gross_amount numeric(18,4) not null default 0,
  usdt_amount numeric(18,4) not null default 0,
  opx_amount numeric(18,4) not null default 0,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.daily_task_completions add column if not exists gross_amount numeric(18,4) not null default 0;
alter table public.daily_task_completions add column if not exists usdt_amount numeric(18,4) not null default 0;
alter table public.daily_task_completions add column if not exists opx_amount numeric(18,4) not null default 0;
alter table public.daily_task_completions add column if not exists transaction_id uuid references public.transactions(id) on delete set null;
create unique index if not exists daily_task_completions_user_day_task_uidx
  on public.daily_task_completions(user_id, task_date, task_key);
create index if not exists daily_task_completions_user_date_idx
  on public.daily_task_completions(user_id, task_date);

create table if not exists public.daily_task_entities (
  id uuid primary key default uuid_generate_v4(),
  snapshot_date date not null,
  entity_key text not null,
  category text not null check (category in ('technology', 'ai', 'crypto')),
  name text not null,
  summary text not null,
  image_url text not null default '',
  source text not null,
  created_at timestamptz not null default now(),
  unique(snapshot_date, entity_key)
);
create index if not exists daily_task_entities_snapshot_category_idx
  on public.daily_task_entities(snapshot_date, category);
alter table public.daily_task_entities drop constraint if exists daily_task_entities_category_check;
alter table public.daily_task_entities add constraint daily_task_entities_category_check
  check (category in ('technology', 'ai', 'crypto', 'trading', 'finance'));

create table if not exists public.daily_task_assignments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  tier_code text not null,
  task_date date not null,
  task_number integer not null check (task_number >= 2),
  category text not null check (category in ('technology', 'ai', 'crypto')),
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
create index if not exists daily_task_assignments_user_recent_idx
  on public.daily_task_assignments(user_id, task_date desc);
alter table public.daily_task_assignments drop constraint if exists daily_task_assignments_category_check;
alter table public.daily_task_assignments add constraint daily_task_assignments_category_check
  check (category in ('technology', 'ai', 'crypto', 'trading', 'finance'));

create table if not exists public.daily_task_submissions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_key text not null,
  task_date date not null default (now() at time zone 'UTC')::date,
  assignment_id uuid references public.daily_task_assignments(id) on delete set null,
  entity_key text not null default '',
  target_category text not null check (target_category in ('technology', 'ai', 'crypto')),
  target_name text not null,
  rating integer not null check (rating between 1 and 5),
  selected_tag text not null default '',
  feedback text not null default '',
  strengths text not null default '',
  concerns text not null default '',
  evidence_url text not null default 'in-app-daily-entity-review',
  created_at timestamptz not null default now(),
  unique(user_id, task_key, task_date)
);
alter table public.daily_task_submissions add column if not exists assignment_id uuid references public.daily_task_assignments(id) on delete set null;
alter table public.daily_task_submissions add column if not exists entity_key text not null default '';
alter table public.daily_task_submissions add column if not exists selected_tag text not null default '';
alter table public.daily_task_submissions add column if not exists feedback text not null default '';
alter table public.daily_task_submissions add column if not exists strengths text not null default '';
alter table public.daily_task_submissions add column if not exists concerns text not null default '';
alter table public.daily_task_submissions add column if not exists evidence_url text not null default 'in-app-daily-entity-review';
create index if not exists daily_task_submissions_user_date_idx
  on public.daily_task_submissions(user_id, task_date);
alter table public.daily_task_submissions drop constraint if exists daily_task_submissions_target_category_check;
alter table public.daily_task_submissions add constraint daily_task_submissions_target_category_check
  check (target_category in ('technology', 'ai', 'crypto', 'trading', 'finance'));

create table if not exists public.referral_reward_awards (
  id uuid primary key default uuid_generate_v4(),
  referrer_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  level_number integer not null check (level_number between 1 and 3),
  tier_code text not null,
  amount numeric(18,4) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(referred_user_id, level_number)
);
create index if not exists referral_reward_awards_referrer_created_idx
  on public.referral_reward_awards(referrer_id, created_at desc);

create table if not exists public.milestone_reward_awards (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  milestone_key text not null,
  tier_code text not null,
  active_referrals integer not null check (active_referrals >= 0),
  amount numeric(18,4) not null check (amount > 0),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id, milestone_key)
);
create index if not exists milestone_reward_awards_user_created_idx
  on public.milestone_reward_awards(user_id, created_at desc);

-- The six-referral rule supersedes the previous 25-referral cycle.
insert into public.game_settings(key, referrals_per_cycle)
values ('default', 6)
on conflict (key) do update set referrals_per_cycle = 6, updated_at = now();

create or replace function public.operix_guard_weekend_task_completion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if extract(dow from (now() at time zone 'UTC')::date) in (5, 6)
      or extract(dow from new.task_date) in (5, 6) then
    raise exception using errcode = 'P0001', message = 'TASK_HOLIDAY';
  end if;
  return new;
end;
$$;
drop trigger if exists daily_task_weekend_holiday_guard on public.daily_task_completions;
create trigger daily_task_weekend_holiday_guard
before insert on public.daily_task_completions
for each row execute function public.operix_guard_weekend_task_completion();

create or replace function public.operix_guard_tier_withdrawal_day()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  user_tier text;
  request_day integer := extract(dow from (now() at time zone 'UTC')::date)::integer;
  allowed_day integer;
begin
  if new.type <> 'withdraw' then return new; end if;
  select upper(trim(tier_code)) into user_tier from public.users where id = new.user_id;
  if user_tier is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  allowed_day := case when user_tier in ('A1', 'A2') then 5 else 6 end;
  if request_day <> allowed_day then
    raise exception using errcode = 'P0001', message = 'WITHDRAWAL_DAY_NOT_ALLOWED';
  end if;
  return new;
end;
$$;
drop trigger if exists withdrawal_tier_day_guard on public.transactions;
create trigger withdrawal_tier_day_guard
before insert on public.transactions
for each row when (new.type = 'withdraw')
execute function public.operix_guard_tier_withdrawal_day();
revoke all on function public.operix_guard_weekend_task_completion() from public, anon, authenticated;
revoke all on function public.operix_guard_tier_withdrawal_day() from public, anon, authenticated;

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
  task_day date := (now() at time zone 'UTC')::date;
  max_tasks integer;
  requested_task_number integer;
  completed_count integer;
  gross_reward numeric(18,4);
  usdt_reward numeric(18,4);
  opx_reward numeric(18,4);
  balance_before numeric(18,4);
  completion_id uuid;
  reward_transaction_id uuid;
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if lower(coalesce(user_row.email, '')) <> 'official@operix.website' and wallet_row.total_deposits <= 0 then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;

  select * into level_row from vip_levels where code = user_row.tier_code;
  if level_row.id is null then raise exception using errcode = 'P0002', message = 'VIP_LEVEL_NOT_FOUND'; end if;
  max_tasks := greatest(coalesce(level_row.tasks, 1), 1);
  if p_task_key = (user_row.tier_code || '-community') then
    requested_task_number := 1;
  elsif p_task_key ~ ('^' || user_row.tier_code || '-task-[0-9]+$') then
    requested_task_number := substring(p_task_key from '[0-9]+$')::integer;
  else
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY';
  end if;
  if requested_task_number < 1 or requested_task_number > max_tasks then
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY';
  end if;
  if requested_task_number = 1 and p_task_key <> (user_row.tier_code || '-community') then
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY';
  end if;

  if requested_task_number > 1 then
    select * into assignment_row
    from daily_task_assignments assignment
    where assignment.user_id = p_user_id
      and assignment.tier_code = user_row.tier_code
      and assignment.task_date = task_day
      and assignment.task_number = requested_task_number;
    if assignment_row.id is null then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;
    if not exists (
      select 1 from daily_task_submissions submission
      where submission.user_id = p_user_id
        and submission.task_key = p_task_key
        and submission.task_date = task_day
        and submission.assignment_id = assignment_row.id
        and submission.entity_key = assignment_row.entity_key
        and submission.target_category = assignment_row.category
        and submission.target_name = assignment_row.entity_name
        and submission.selected_tag = any(assignment_row.allowed_tags)
        and length(trim(submission.feedback)) between 10 and 500
        and submission.rating between 1 and 5
    ) then
      raise exception using errcode = 'P0001', message = 'EVALUATION_REQUIRED';
    end if;
  end if;

  if p_task_key = (user_row.tier_code || '-community') and (
    not exists (
      select 1 from social_posts own_post
      where own_post.author_id = p_user_id
        and own_post.status = 'visible'
        and own_post.source = 'user'
        and not own_post.is_official_ai
        and own_post.created_at >= (task_day::timestamp at time zone 'UTC')
        and (own_post.content ilike '%OPERIX%' or own_post.content ilike '%أوبيريكس%')
    )
    or not exists (
      select 1 from social_posts other_post
      where other_post.author_id is distinct from p_user_id
        and other_post.status = 'visible'
        and exists (
          select 1
          from jsonb_array_elements(coalesce(other_post.comments, '[]'::jsonb)) as comments(comment_entry)
          where coalesce(comments.comment_entry->>'authorId', comments.comment_entry->>'author_id') = p_user_id::text
            and coalesce(comments.comment_entry->>'status', 'visible') = 'visible'
            and left(coalesce(comments.comment_entry->>'createdAt', comments.comment_entry->>'created_at', ''), 10) = to_char(task_day, 'YYYY-MM-DD')
        )
    )
  ) then
    raise exception using errcode = 'P0001', message = 'COMMUNITY_TASK_REQUIRED';
  end if;

  gross_reward := round(coalesce(level_row.daily_profit, 0) / max_tasks, 4);
  opx_reward := round(
    least(
      coalesce(level_row.daily_profit, 0),
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

  insert into daily_task_completions(user_id, task_key, task_date, gross_amount, usdt_amount, opx_amount)
  values(p_user_id, p_task_key, task_day, gross_reward, usdt_reward, opx_reward)
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
  values(p_user_id, 'reward', 'USDT', usdt_reward, usdt_reward, balance_before, balance_before + usdt_reward, 'approved', 'daily_task', reward_transaction_id::text,
    jsonb_build_object('taskKey', p_task_key, 'grossAmount', gross_reward, 'opxAmount', opx_reward));

  select count(*) into completed_count
  from daily_task_completions where user_id = p_user_id and task_date = task_day;
  update users set today_completed_tasks = completed_count, updated_at = now() where id = p_user_id;

  return jsonb_build_object(
    'taskKey', p_task_key,
    'completed', completed_count,
    'taskLimit', max_tasks,
    'assetWallet', (select asset_wallet from users where id = p_user_id),
    'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id),
    'grossAmount', gross_reward,
    'usdtAmount', usdt_reward,
    'opxAmount', opx_reward,
    'transactionId', reward_transaction_id
  );
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
  current_level vip_levels%rowtype;
  target_level vip_levels%rowtype;
  upgrade_row transactions%rowtype;
  before_balance numeric(18,4);
  before_opx_balance numeric(18,4);
  current_level_number integer;
  target_level_number integer;
  expected_upgrade_cost numeric(18,4);
  active_referrals_count integer := 0;
  reward_amount numeric(18,4) := 0;
  reward_awarded numeric(18,4) := 0;
  referrer_balance numeric(18,4) := 0;
  trusted_referrer_id uuid;
  free_tier_four boolean := false;
  milestone_award_id uuid;
  milestone_transaction_id uuid;
  milestone_balance_before numeric(18,4);
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  if user_row.tier_code is distinct from p_expected_tier then raise exception using errcode = 'P0001', message = 'TIER_CHANGED'; end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  select * into current_level from vip_levels where code = user_row.tier_code;
  select * into target_level from vip_levels where code = p_target_tier;
  if target_level.id is null then raise exception using errcode = 'P0002', message = 'VIP_LEVEL_NOT_FOUND'; end if;

  select ranked.level_number into target_level_number
  from (select code, row_number() over (order by price asc, code asc)::integer as level_number from vip_levels) ranked
  where ranked.code = p_target_tier;
  select ranked.level_number into current_level_number
  from (select code, row_number() over (order by price asc, code asc)::integer as level_number from vip_levels) ranked
  where ranked.code = user_row.tier_code;
  if target_level_number is null or current_level_number is null then
    raise exception using errcode = 'P0002', message = 'VIP_LEVEL_NOT_FOUND';
  end if;

  if lower(coalesce(user_row.email, '')) <> 'official@operix.website'
    and (target_level_number < current_level_number
      or (target_level_number = current_level_number and wallet_row.total_deposits > 0)) then
    raise exception using errcode = 'P0001', message = 'INVALID_TIER_PROGRESSION';
  end if;

  if p_upgrade_cost is null or p_usdt_amount is null or p_opx_amount is null or p_opx_value is null
    or p_upgrade_cost < 0 or p_usdt_amount < 0 or p_opx_amount < 0 or p_opx_value < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_UPGRADE_PAYMENT';
  end if;

  if p_target_tier = 'A4' and user_row.tier_code <> 'A4'
    and lower(coalesce(user_row.email, '')) <> 'official@operix.website'
    and p_upgrade_cost = 0 and p_usdt_amount = 0 and p_opx_amount = 0 and p_opx_value = 0 then
    select count(*)::integer into active_referrals_count
    from users referred
    join wallet_balances referred_wallet on referred_wallet.user_id = referred.id
    where upper(trim(coalesce(referred.referred_by, ''))) = upper(trim(coalesce(user_row.referral_code, '')))
      and not coalesce(referred.is_banned, false)
      and referred_wallet.total_deposits > 0;
    if active_referrals_count < 300 then
      raise exception using errcode = 'P0001', message = 'A4_MILESTONE_NOT_ELIGIBLE';
    end if;
    if exists (
      select 1 from milestone_reward_awards
      where user_id = p_user_id and milestone_key = 'active_referrals_300_a4'
    ) then
      raise exception using errcode = 'P0001', message = 'A4_MILESTONE_ALREADY_AWARDED';
    end if;
    free_tier_four := true;
  end if;

  if lower(coalesce(user_row.email, '')) = 'official@operix.website' then
    if p_upgrade_cost <> 0 or p_usdt_amount <> 0 or p_opx_amount <> 0 or p_opx_value <> 0 then
      raise exception using errcode = 'P0001', message = 'INVALID_OFFICIAL_UPGRADE_PAYMENT';
    end if;
  elsif not free_tier_four then
    expected_upgrade_cost := case
      when wallet_row.total_deposits > 0 then greatest(target_level.price - coalesce(current_level.price, 0), 0)
      else target_level.price
    end;
    if abs(p_upgrade_cost - expected_upgrade_cost) > 0.01 then
      raise exception using errcode = 'P0001', message = 'INVALID_UPGRADE_COST';
    end if;
    if abs(p_upgrade_cost - p_usdt_amount - p_opx_value) > 0.011 then
      raise exception using errcode = 'P0001', message = 'INVALID_UPGRADE_PAYMENT';
    end if;
    if p_opx_amount > 0 then
      if abs(p_opx_value - round(p_opx_amount * 0.10, 2)) > 0.011
        or p_opx_value > least(p_upgrade_cost * 0.10, 60) + 0.011 then
        raise exception using errcode = 'P0001', message = 'OPX_SHARE_EXCEEDS_LIMIT';
      end if;
    elsif p_opx_value <> 0 then
      raise exception using errcode = 'P0001', message = 'INVALID_OPX_VALUE';
    end if;
  end if;

  if wallet_row.deposit_balance < p_usdt_amount then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_DEPOSIT';
  end if;
  if wallet_row.opx_balance < p_opx_amount then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_OPX';
  end if;
  before_balance := wallet_row.balance;
  before_opx_balance := wallet_row.opx_balance;

  update users set tier_code = p_target_tier, updated_at = now() where id = p_user_id;
  update wallet_balances
  set deposit_balance = deposit_balance - p_usdt_amount,
      opx_balance = opx_balance - p_opx_amount,
      balance = deposit_balance - p_usdt_amount + profit_balance,
      usdt_balance = deposit_balance - p_usdt_amount + profit_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, opx_amount, wallet_address)
  values(p_user_id, 'upgrade_deduction', 'approved', p_upgrade_cost, p_upgrade_cost, p_usdt_amount, p_opx_amount, 'Upgrade to ' || coalesce(p_target_name, target_level.name))
  returning * into upgrade_row;
  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'upgrade_deduction', 'USDT', p_usdt_amount, p_usdt_amount, before_balance,
    before_balance - p_usdt_amount, 'approved', 'tier_upgrade', upgrade_row.id::text,
    jsonb_build_object('grossUpgradeCost', p_upgrade_cost, 'opxValue', p_opx_value));

  if p_opx_amount > 0 then
    insert into transactions(user_id, type, status, amount, gross_amount, opx_amount, wallet_address)
    values(p_user_id, 'token_burn', 'approved', p_opx_value, p_opx_value, p_opx_amount, 'Burn OPX for ' || coalesce(p_target_name, target_level.name));
    insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
    values(p_user_id, 'token_burn', 'OPX', p_opx_amount, p_opx_amount, before_opx_balance,
      before_opx_balance - p_opx_amount, 'approved', 'tier_upgrade', upgrade_row.id::text,
      jsonb_build_object('usdValue', p_opx_value, 'targetTier', p_target_tier));
  end if;

  if free_tier_four then
    insert into milestone_reward_awards(user_id, milestone_key, tier_code, active_referrals, amount)
    values(p_user_id, 'active_referrals_300_a4', 'A4', active_referrals_count, 100)
    on conflict (user_id, milestone_key) do nothing
    returning id into milestone_award_id;
    if milestone_award_id is null then
      raise exception using errcode = 'P0001', message = 'A4_MILESTONE_ALREADY_AWARDED';
    end if;

    select balance into milestone_balance_before from wallet_balances where user_id = p_user_id for update;
    update wallet_balances
    set profit_balance = profit_balance + 100,
        balance = deposit_balance + profit_balance + 100,
        usdt_balance = deposit_balance + profit_balance + 100,
        updated_at = now()
    where user_id = p_user_id;
    insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address)
    values(p_user_id, 'reward', 'approved', 100, 100, 100, 'A4 milestone: 300 active referrals')
    returning id into milestone_transaction_id;
    update milestone_reward_awards set transaction_id = milestone_transaction_id where id = milestone_award_id;
    insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, notes, metadata)
    select p_user_id, 'reward', 'USDT', 100, 100, milestone_balance_before, w.balance,
      'approved', 'referral_milestone', milestone_transaction_id::text,
      'Free A4 activation reward at 300 active direct referrals',
      jsonb_build_object('milestoneKey', 'active_referrals_300_a4', 'activeReferrals', active_referrals_count)
    from wallet_balances w where w.user_id = p_user_id;
    insert into notifications(user_id, title, body, type)
    values(p_user_id, 'مكافأة تفعيل المستوى الرابع', 'تم تفعيل A4 مجانًا وإضافة $100 إلى رصيد الأرباح بعد بلوغ 300 إحالة فعّالة.', 'transaction');
  end if;

  if p_referrer_id is not null and user_row.referred_by is not null and p_referrer_id <> p_user_id and p_upgrade_cost > 0 then
    select id into trusted_referrer_id
    from users
    where id = p_referrer_id and upper(trim(referral_code)) = upper(trim(user_row.referred_by))
    for update;
  end if;
  reward_amount := case target_level_number when 1 then 1 when 2 then 2 when 3 then 5 else 0 end;
  if trusted_referrer_id is not null and reward_amount > 0 then
    select * into ref_wallet from wallet_balances where user_id = trusted_referrer_id for update;
    if ref_wallet.id is not null then
      insert into referral_reward_awards(referrer_id, referred_user_id, level_number, tier_code, amount)
      values(trusted_referrer_id, p_user_id, target_level_number, p_target_tier, reward_amount)
      on conflict (referred_user_id, level_number) do nothing
      returning amount into reward_awarded;
      if reward_awarded is not null then
        update wallet_balances
        set profit_balance = profit_balance + reward_awarded,
            balance = deposit_balance + profit_balance + reward_awarded,
            usdt_balance = deposit_balance + profit_balance + reward_awarded,
            updated_at = now()
        where user_id = trusted_referrer_id
        returning balance into referrer_balance;
        insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address)
        values(trusted_referrer_id, 'referral_commission', 'approved', reward_awarded, reward_awarded, reward_awarded,
          'Referral activation reward from ' || user_row.email);
        insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, notes)
        values(trusted_referrer_id, 'referral_commission', 'USDT', reward_awarded, reward_awarded, ref_wallet.balance,
          referrer_balance, 'approved', 'referral_tier_activation', upgrade_row.id::text,
          'Tier ' || target_level_number::text || ' referral activation reward');
        insert into notifications(user_id, title, body, type)
        values(trusted_referrer_id, 'مكافأة إحالة جديدة',
          'تمت إضافة $' || to_char(reward_awarded, 'FM999999990.00') || ' إلى رصيد أرباحك بعد تفعيل إحالتك المباشرة للمستوى ' || target_level_number::text || '.',
          'transaction');
      else
        select balance into referrer_balance from wallet_balances where user_id = trusted_referrer_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'user', (select row_to_json(u) from users u where u.id = p_user_id),
    'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id),
    'referralRewardAwarded', coalesce(reward_awarded, 0),
    'referrerBalance', coalesce(referrer_balance, 0),
    'freeTierFourActivation', free_tier_four,
    'instantProfitReward', case when free_tier_four then 100 else 0 end
  );
end;
$$;

-- Every public table is accessed through the backend service-role client.
-- Disable direct Data API access to anon/authenticated while retaining server access.
do $$
declare
  table_row record;
  function_row record;
begin
  for table_row in
    select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I.%I enable row level security', table_row.schemaname, table_row.tablename);
    execute format('revoke all privileges on table %I.%I from public, anon, authenticated', table_row.schemaname, table_row.tablename);
    execute format('grant all privileges on table %I.%I to service_role', table_row.schemaname, table_row.tablename);
  end loop;

  for function_row in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', function_row.signature);
    execute format('grant execute on function %s to service_role', function_row.signature);
  end loop;
end;
$$;

commit;
