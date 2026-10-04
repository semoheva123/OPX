-- Per-user TRON USDT deposit addresses and idempotent confirmed-deposit crediting.
-- Generate TRON_DEPOSIT_XPUB offline from a dedicated seed at m/44'/195'/0'/0; never put the seed/private keys in Vercel.
begin;

create table if not exists public.tron_deposit_addresses (
  user_id uuid primary key references public.users(id) on delete restrict,
  derivation_index bigint not null unique check (derivation_index >= 0),
  address text unique,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tron_deposit_address_format check (address is null or address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
);

create table if not exists public.tron_deposit_address_sequences (
  id smallint primary key check (id = 1),
  next_index bigint not null check (next_index >= 0)
);
insert into public.tron_deposit_address_sequences(id, next_index) values (1, 0)
on conflict (id) do nothing;

create table if not exists public.tron_deposit_events (
  id uuid primary key default uuid_generate_v4(),
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  tx_hash text not null unique check (tx_hash ~ '^[a-fA-F0-9]{64}$'),
  event_index integer not null default 0 check (event_index >= 0),
  from_address text not null,
  to_address text not null,
  amount numeric(20,6) not null check (amount > 0),
  block_timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.tron_deposit_addresses enable row level security;
alter table public.tron_deposit_address_sequences enable row level security;
alter table public.tron_deposit_events enable row level security;
revoke all privileges on table public.tron_deposit_addresses, public.tron_deposit_address_sequences, public.tron_deposit_events from public, anon, authenticated;
grant all privileges on table public.tron_deposit_addresses, public.tron_deposit_address_sequences, public.tron_deposit_events to service_role;

create or replace function public.operix_tron_deposit_address_reserve_atomic(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare address_row tron_deposit_addresses%rowtype; next_idx bigint;
begin
  select * into address_row from tron_deposit_addresses where user_id = p_user_id for update;
  if address_row.user_id is not null then
    return jsonb_build_object('userId', address_row.user_id, 'derivationIndex', address_row.derivation_index, 'address', address_row.address);
  end if;
  select next_index into next_idx from tron_deposit_address_sequences where id = 1 for update;
  if next_idx is null then raise exception using errcode = 'P0001', message = 'TRON_DEPOSIT_SEQUENCE_NOT_INITIALIZED'; end if;
  update tron_deposit_address_sequences set next_index = next_idx + 1 where id = 1;
  insert into tron_deposit_addresses(user_id, derivation_index) values(p_user_id, next_idx)
    on conflict (user_id) do nothing;
  select * into address_row from tron_deposit_addresses where user_id = p_user_id;
  return jsonb_build_object('userId', address_row.user_id, 'derivationIndex', address_row.derivation_index, 'address', address_row.address);
end;
$$;

create or replace function public.operix_tron_deposit_address_assign_atomic(p_user_id uuid, p_derivation_index bigint, p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare address_row tron_deposit_addresses%rowtype;
begin
  if p_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then raise exception using errcode = 'P0001', message = 'INVALID_TRON_DEPOSIT_ADDRESS'; end if;
  update tron_deposit_addresses set address = p_address, updated_at = now()
    where user_id = p_user_id and derivation_index = p_derivation_index and (address is null or address = p_address)
    returning * into address_row;
  if address_row.user_id is null then
    select * into address_row from tron_deposit_addresses where user_id = p_user_id;
    if address_row.address is distinct from p_address then raise exception using errcode = 'P0001', message = 'TRON_DEPOSIT_ADDRESS_ASSIGNMENT_CONFLICT'; end if;
  end if;
  return jsonb_build_object('userId', address_row.user_id, 'derivationIndex', address_row.derivation_index, 'address', address_row.address);
end;
$$;

create or replace function public.operix_tron_deposit_credit_atomic(
  p_user_id uuid, p_tx_hash text, p_event_index integer, p_from_address text, p_to_address text,
  p_amount numeric, p_block_timestamp timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  address_row tron_deposit_addresses%rowtype;
  wallet_row wallet_balances%rowtype;
  transaction_row transactions%rowtype;
  event_row tron_deposit_events%rowtype;
  before_balance numeric;
  normalized_hash text := lower(trim(coalesce(p_tx_hash, '')));
begin
  if normalized_hash !~ '^[a-f0-9]{64}$' or p_amount <= 0 or p_event_index < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_TRON_DEPOSIT_EVENT';
  end if;
  select * into address_row from tron_deposit_addresses where user_id = p_user_id for update;
  if address_row.user_id is null or address_row.address is null or address_row.address <> trim(p_to_address) then
    raise exception using errcode = 'P0001', message = 'TRON_DEPOSIT_ADDRESS_USER_MISMATCH';
  end if;
  if exists (select 1 from tron_deposit_events where tx_hash = normalized_hash)
     or exists (select 1 from transactions where type = 'deposit' and tx_hash = normalized_hash) then
    return jsonb_build_object('credited', false, 'duplicate', true);
  end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  before_balance := wallet_row.balance;
  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address, tx_hash, network, created_at)
    values(p_user_id, 'deposit', 'approved', p_amount, p_amount, p_amount, address_row.address, normalized_hash, 'TRC20', coalesce(p_block_timestamp, now()))
    returning * into transaction_row;
  insert into tron_deposit_events(transaction_id, user_id, tx_hash, event_index, from_address, to_address, amount, block_timestamp)
    values(transaction_row.id, p_user_id, normalized_hash, p_event_index, trim(p_from_address), address_row.address, p_amount, coalesce(p_block_timestamp, now()))
    returning * into event_row;
  update wallet_balances set deposit_balance = deposit_balance + p_amount,
    total_deposits = total_deposits + p_amount,
    balance = deposit_balance + profit_balance + p_amount,
    usdt_balance = deposit_balance + profit_balance + p_amount,
    updated_at = now()
    where user_id = p_user_id returning * into wallet_row;
  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
    values(p_user_id, 'deposit', 'USDT', p_amount, p_amount, before_balance, wallet_row.balance, 'approved', 'automatic_trc20_deposit', transaction_row.id::text,
      jsonb_build_object('network', 'TRC20', 'txHash', normalized_hash, 'eventIndex', p_event_index, 'fromAddress', p_from_address, 'toAddress', address_row.address));
  return jsonb_build_object('credited', true, 'duplicate', false, 'transaction', row_to_json(transaction_row), 'wallet', row_to_json(wallet_row));
end;
$$;

revoke all on function public.operix_tron_deposit_address_reserve_atomic(uuid) from public, anon, authenticated;
revoke all on function public.operix_tron_deposit_address_assign_atomic(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.operix_tron_deposit_credit_atomic(uuid, text, integer, text, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.operix_tron_deposit_address_reserve_atomic(uuid) to service_role;
grant execute on function public.operix_tron_deposit_address_assign_atomic(uuid, bigint, text) to service_role;
grant execute on function public.operix_tron_deposit_credit_atomic(uuid, text, integer, text, text, numeric, timestamptz) to service_role;

commit;
