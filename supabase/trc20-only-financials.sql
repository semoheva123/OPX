-- Enforce TRC20 for all newly created/retargeted deposit and withdrawal records.
-- Existing historical BEP20 rows are left readable and can still be reconciled.
begin;

create or replace function public.operix_enforce_trc20_financial_network()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.type in ('deposit', 'withdraw') and new.network is distinct from 'TRC20' then
    raise exception using errcode = 'P0001', message = 'TRC20_ONLY_SUPPORTED';
  end if;
  return new;
end;
$$;

drop trigger if exists operix_trc20_only_transactions on public.transactions;
create trigger operix_trc20_only_transactions
before insert or update of type, network on public.transactions
for each row execute function public.operix_enforce_trc20_financial_network();

create or replace function public.operix_enforce_trc20_user_wallet()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.wallet_network is not null and new.wallet_network <> '' and new.wallet_network <> 'TRC20' then
    raise exception using errcode = 'P0001', message = 'TRC20_ONLY_SUPPORTED';
  end if;
  return new;
end;
$$;

drop trigger if exists operix_trc20_only_user_wallet on public.users;
create trigger operix_trc20_only_user_wallet
before insert or update of wallet_network on public.users
for each row execute function public.operix_enforce_trc20_user_wallet();

commit;
