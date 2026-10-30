-- Keep Friday as the weekly task holiday; withdrawals are available every day.
-- Apply to the existing Supabase project before deploying the matching app code.
begin;

create or replace function public.operix_guard_weekend_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(dow from (now() at time zone 'Europe/Istanbul')::date) = 5
      or extract(dow from new.task_date) = 5 then
    raise exception using errcode = 'P0001', message = 'TASK_HOLIDAY';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_task_weekend_holiday_guard on public.daily_task_completions;
create trigger daily_task_weekend_holiday_guard
before insert on public.daily_task_completions
for each row execute function public.operix_guard_weekend_task_completion();

-- Remove the old tier-specific withdrawal weekday guard when upgrading an existing database.
drop trigger if exists withdrawal_tier_day_guard on public.transactions;
drop function if exists public.operix_guard_tier_withdrawal_day();

revoke all on function public.operix_guard_weekend_task_completion() from public, anon, authenticated;

commit;
