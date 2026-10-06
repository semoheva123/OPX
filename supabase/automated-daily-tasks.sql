begin;

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
create index if not exists daily_task_entities_snapshot_category_idx on public.daily_task_entities(snapshot_date, category);
alter table public.daily_task_entities drop constraint if exists daily_task_entities_category_check;
alter table public.daily_task_entities add constraint daily_task_entities_category_check
  check (category in ('technology', 'ai', 'crypto', 'trading', 'finance'));
alter table public.daily_task_entities enable row level security;
revoke all on table public.daily_task_entities from public, anon, authenticated;
grant all on table public.daily_task_entities to service_role;

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
create index if not exists daily_task_assignments_user_recent_idx on public.daily_task_assignments(user_id, task_date desc);
alter table public.daily_task_assignments drop constraint if exists daily_task_assignments_category_check;
alter table public.daily_task_assignments add constraint daily_task_assignments_category_check
  check (category in ('technology', 'ai', 'crypto', 'trading', 'finance'));
alter table public.daily_task_assignments enable row level security;
revoke all on table public.daily_task_assignments from public, anon, authenticated;
grant all on table public.daily_task_assignments to service_role;

alter table public.daily_task_submissions add column if not exists assignment_id uuid references public.daily_task_assignments(id) on delete set null;
alter table public.daily_task_submissions add column if not exists entity_key text not null default '';
alter table public.daily_task_submissions add column if not exists selected_tag text not null default '';
alter table public.daily_task_submissions add column if not exists feedback text not null default '';
alter table public.daily_task_submissions drop constraint if exists daily_task_submissions_target_category_check;
alter table public.daily_task_submissions add constraint daily_task_submissions_target_category_check
  check (target_category in ('technology', 'ai', 'crypto', 'trading', 'finance'));
alter table public.daily_task_submissions enable row level security;
revoke all on table public.daily_task_submissions from public, anon, authenticated;
grant all on table public.daily_task_submissions to service_role;

create or replace function public.operix_enforce_daily_task_sequence_and_cooldown()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_tier text; task_number integer; previous_task_key text; plan_started_at timestamptz;
begin
  select tier_code into current_tier from public.users where id = new.user_id for update;
  if current_tier is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  if new.task_key = current_tier || '-community' then raise exception using errcode = 'P0001', message = 'OPTIONAL_TASK_NO_REWARD';
  elsif new.task_key ~ ('^' || current_tier || '-task-[0-9]+$') then task_number := substring(new.task_key from '[0-9]+$')::integer;
  else raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;
  if task_number < 2 then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;
  if task_number > 2 then
    previous_task_key := current_tier || '-task-' || lpad((task_number - 1)::text, 2, '0');
    if not exists (select 1 from public.daily_task_completions
      where user_id = new.user_id and task_date = new.task_date and task_key = previous_task_key) then
      raise exception using errcode = 'P0001', message = 'TASK_SEQUENCE_REQUIRED';
    end if;
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
  max_tasks := greatest(coalesce(level_row.tasks, 1) - 1, 0);
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

commit;
