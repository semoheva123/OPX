-- Rating-only task submissions and sequential 3-hour release enforcement.
-- Apply after automated-daily-tasks.sql.
begin;

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
    requested_task_number := 1;
  elsif p_task_key ~ ('^' || user_row.tier_code || '-task-[0-9]+$') then
    requested_task_number := substring(p_task_key from '[0-9]+$')::integer;
  else
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY';
  end if;
  if requested_task_number < 1 or requested_task_number > max_tasks then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;
  if requested_task_number = 1 and p_task_key <> (user_row.tier_code || '-community') then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;

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

  if p_task_key = (user_row.tier_code || '-community') and (
    not exists (
      select 1 from social_posts own_post
      where own_post.author_id = p_user_id
        and own_post.status = 'visible'
        and own_post.source = 'user'
        and not own_post.is_official_ai
        and own_post.created_at >= ((now() at time zone 'UTC')::date::timestamp at time zone 'UTC')
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
            and left(coalesce(comments.comment_entry->>'createdAt', comments.comment_entry->>'created_at', ''), 10) = to_char(now() at time zone 'UTC', 'YYYY-MM-DD')
        )
    )
  ) then
    raise exception using errcode = 'P0001', message = 'COMMUNITY_TASK_REQUIRED';
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

  select count(*) into completed_count from daily_task_completions where user_id = p_user_id and task_date = current_date;
  update users set today_completed_tasks = completed_count, updated_at = now() where id = p_user_id;
  return jsonb_build_object('taskKey', p_task_key, 'completed', completed_count, 'taskLimit', max_tasks, 'assetWallet', (select asset_wallet from users where id = p_user_id), 'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id), 'grossAmount', gross_reward, 'usdtAmount', usdt_reward, 'opxAmount', opx_reward, 'transactionId', reward_transaction_id);
end;
$$;

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
  previous_completed_at timestamptz;
begin
  select tier_code into current_tier from public.users where id = new.user_id for update;
  if current_tier is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;

  if new.task_key = current_tier || '-community' then
    task_number := 1;
  elsif new.task_key ~ ('^' || current_tier || '-task-[0-9]+$') then
    task_number := substring(new.task_key from '[0-9]+$')::integer;
  else
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY';
  end if;
  if task_number < 1 then raise exception using errcode = 'P0001', message = 'INVALID_TASK_KEY'; end if;

  if task_number > 1 then
    previous_task_key := case when task_number = 2
      then current_tier || '-community'
      else current_tier || '-task-' || lpad((task_number - 1)::text, 2, '0')
    end;
    select created_at into previous_completed_at
      from public.daily_task_completions
      where user_id = new.user_id and task_date = new.task_date and task_key = previous_task_key;
    if previous_completed_at is null then
      raise exception using errcode = 'P0001', message = 'TASK_SEQUENCE_REQUIRED';
    end if;
    if previous_completed_at + interval '3 hours' > clock_timestamp() then
      raise exception using errcode = 'P0001', message = 'TASK_COOLDOWN_ACTIVE';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists daily_task_sequence_and_cooldown on public.daily_task_completions;
create trigger daily_task_sequence_and_cooldown
before insert on public.daily_task_completions
for each row execute function public.operix_enforce_daily_task_sequence_and_cooldown();

revoke all on function public.operix_daily_task_complete_atomic(uuid, text) from public, anon, authenticated;
revoke all on function public.operix_enforce_daily_task_sequence_and_cooldown() from public, anon, authenticated;
grant execute on function public.operix_daily_task_complete_atomic(uuid, text) to service_role;

commit;
