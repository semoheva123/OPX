begin;

alter table public.users
  add column if not exists tier_activated boolean not null default false;

update public.users u
set tier_activated = true
where not u.tier_activated and (
  upper(coalesce(u.tier_code, 'A1')) <> 'A1'
  or
  exists (
    select 1 from public.wallet_balances w
    where w.user_id = u.id and w.total_deposits > 0
  )
  or exists (
    select 1 from public.transactions t
    where t.user_id = u.id
      and t.type = 'upgrade_deduction'
      and t.status in ('approved', 'completed')
  )
  or exists (
    select 1 from public.milestone_reward_awards m
    where m.user_id = u.id and m.milestone_key = 'active_referrals_300_a4'
  )
);

do $migration$
declare
  function_signature regprocedure := to_regprocedure('public.operix_upgrade_atomic(uuid,text,text,numeric,numeric,numeric,numeric,uuid,numeric,text)');
  function_definition text;
  updated_definition text;
begin
  if function_signature is null then
    raise exception 'operix_upgrade_atomic function not found';
  end if;

  select pg_get_functiondef(function_signature) into function_definition;
  updated_definition := regexp_replace(
    function_definition,
    '(target_level_number[[:space:]]*=[[:space:]]*current_level_number[[:space:]]+and[[:space:]]*)wallet_row\.total_deposits[[:space:]]*>[[:space:]]*0',
    $replacement$\1(user_row.tier_activated or wallet_row.total_deposits > 0)$replacement$,
    'g'
  );
  if position('user_row.tier_activated' in lower(updated_definition)) = 0 then
    raise exception 'Could not add the persistent activation guard to operix_upgrade_atomic';
  end if;

  if position('tier_activated = true' in lower(updated_definition)) = 0 then
    updated_definition := regexp_replace(
      updated_definition,
      '(update[[:space:]]+users[[:space:]]+set[[:space:]]+tier_code[[:space:]]*=[[:space:]]*p_target_tier,[[:space:]]*)updated_at[[:space:]]*=[[:space:]]*now\(\)',
      $replacement$\1tier_activated = true, updated_at = now()$replacement$,
      'gi'
    );
  end if;
  if position('tier_activated = true' in lower(updated_definition)) = 0 then
    raise exception 'Could not persist activation in operix_upgrade_atomic';
  end if;

  if updated_definition <> function_definition then
    execute updated_definition;
  end if;
end;
$migration$;

commit;
