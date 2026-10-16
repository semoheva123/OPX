-- Direct shared-wallet USDT TRC20 deposits claimed by TxID and verified against confirmed chain events.
begin;

create table if not exists public.shared_tron_deposit_events (
  tx_hash text primary key check (tx_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.users(id) on delete restrict,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  amount numeric(18,4) not null check (amount > 0),
  from_address text not null,
  to_address text not null check (to_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  event_index integer not null default 0 check (event_index >= 0),
  block_timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.shared_tron_deposit_events enable row level security;
revoke all privileges on table public.shared_tron_deposit_events from public, anon, authenticated;
grant all privileges on table public.shared_tron_deposit_events to service_role;

create or replace function public.operix_shared_tron_deposit_credit_atomic(
  p_user_id uuid,
  p_tx_hash text,
  p_event_index integer,
  p_from_address text,
  p_to_address text,
  p_amount numeric,
  p_block_timestamp timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wallet_row wallet_balances%rowtype;
  transaction_row transactions%rowtype;
  normalized_hash text := lower(trim(coalesce(p_tx_hash, '')));
  normalized_to text := trim(coalesce(p_to_address, ''));
  before_balance numeric;
begin
  if p_user_id is null or normalized_hash !~ '^[a-f0-9]{64}$'
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 4)
     or p_event_index is null or p_event_index < 0
     or normalized_to !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
     or trim(coalesce(p_from_address, '')) = '' then
    raise exception using errcode = 'P0001', message = 'INVALID_SHARED_TRON_DEPOSIT_EVENT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_hash, 0));
  if exists (select 1 from shared_tron_deposit_events where tx_hash = normalized_hash)
      or exists (select 1 from transactions where type = 'deposit' and lower(tx_hash) = normalized_hash) then
    return jsonb_build_object('credited', false, 'duplicate', true);
  end if;

  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  before_balance := wallet_row.balance;

  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address, tx_hash, network, created_at)
  values(p_user_id, 'deposit', 'approved', p_amount, p_amount, p_amount, normalized_to, normalized_hash, 'TRC20', coalesce(p_block_timestamp, now()))
  returning * into transaction_row;

  insert into shared_tron_deposit_events(tx_hash, user_id, transaction_id, amount, from_address, to_address, event_index, block_timestamp)
  values(normalized_hash, p_user_id, transaction_row.id, p_amount, trim(p_from_address), normalized_to, p_event_index, coalesce(p_block_timestamp, now()));

  update wallet_balances set deposit_balance = deposit_balance + p_amount,
    total_deposits = total_deposits + p_amount,
    balance = deposit_balance + profit_balance + p_amount,
    usdt_balance = deposit_balance + profit_balance + p_amount,
    updated_at = now()
  where user_id = p_user_id returning * into wallet_row;

  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'deposit', 'USDT', p_amount, p_amount, before_balance, wallet_row.balance,
    'approved', 'shared_tron_txid_deposit', transaction_row.id::text,
    jsonb_build_object('network', 'TRC20', 'txHash', normalized_hash, 'eventIndex', p_event_index,
      'fromAddress', trim(p_from_address), 'toAddress', normalized_to));

  return jsonb_build_object('credited', true, 'duplicate', false,
    'transaction', row_to_json(transaction_row), 'wallet', row_to_json(wallet_row));
end;
$$;

revoke all on function public.operix_shared_tron_deposit_credit_atomic(uuid, text, integer, text, text, numeric, timestamptz)
  from public, anon, authenticated;
grant execute on function public.operix_shared_tron_deposit_credit_atomic(uuid, text, integer, text, text, numeric, timestamptz)
  to service_role;

commit;
