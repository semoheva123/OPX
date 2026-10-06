-- Enforce weekly task holidays and tier-based withdrawal request days.
-- Apply to the existing Supabase project before deploying the matching app code.
begin;

create or replace function public.operix_guard_weekend_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(dow from (now() at time zone 'Europe/Istanbul')::date) in (5, 6)
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
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_tier text;
  request_day integer := extract(dow from (now() at time zone 'Europe/Istanbul')::date)::integer;
  allowed_day integer;
begin
  if new.type <> 'withdraw' then return new; end if;

  select upper(trim(tier_code)) into user_tier
  from public.users
  where id = new.user_id;
  if user_tier is null then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

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

commit;