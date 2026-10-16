begin;

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
    $pattern$expected_upgrade_cost[[:space:]]*:=[[:space:]]*case[[:space:]]+when[[:space:]]+wallet_row\.total_deposits[[:space:]]*>[[:space:]]*0[[:space:]]+then[[:space:]]+greatest\(target_level\.price[[:space:]]*-[[:space:]]*coalesce\(current_level\.price,[[:space:]]*0\),[[:space:]]*0\)[[:space:]]+else[[:space:]]+target_level\.price[[:space:]]+end;?$pattern$,
    'expected_upgrade_cost := target_level.price;',
    'g'
  );

  if updated_definition = function_definition then
    if position('expected_upgrade_cost := target_level.price;' in function_definition) = 0 then
      raise exception 'Expected existing tier-difference pricing rule was not found; no function changes made';
    end if;
  else
    execute updated_definition;
  end if;
end;
$migration$;

revoke execute on function public.operix_upgrade_atomic(uuid,text,text,numeric,numeric,numeric,numeric,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.operix_upgrade_atomic(uuid,text,text,numeric,numeric,numeric,numeric,uuid,numeric,text) to service_role;

commit;
