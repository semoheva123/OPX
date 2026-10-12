-- NOWPayments USDT TRC20 orders: collect a 1% surcharge and credit only the base deposit.
begin;

create table if not exists public.nowpayments_deposit_orders (
  payment_id text primary key,
  order_id text not null unique,
  user_id uuid not null references public.users(id) on delete restrict,
  price_amount numeric(18,4) not null check (price_amount > 0),
  surcharge_amount numeric(18,4) not null default 0 check (surcharge_amount >= 0),
  charge_amount numeric(18,4) not null check (charge_amount > 0),
  pay_amount numeric(30,12) not null check (pay_amount > 0),
  pay_currency text not null check (lower(pay_currency) = 'usdttrc20'),
  pay_address text not null check (pay_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  payment_status text not null default 'waiting',
  transaction_id uuid unique references public.transactions(id) on delete restrict,
  tx_hash text not null default '',
  actual_paid numeric(30,12) not null default 0,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.nowpayments_deposit_orders add column if not exists surcharge_amount numeric(18,4) not null default 0 check (surcharge_amount >= 0);
alter table public.nowpayments_deposit_orders add column if not exists charge_amount numeric(18,4);
update public.nowpayments_deposit_orders set charge_amount = price_amount + surcharge_amount where charge_amount is null;
alter table public.nowpayments_deposit_orders alter column charge_amount set not null;

create index if not exists nowpayments_deposit_orders_user_created_idx
  on public.nowpayments_deposit_orders(user_id, created_at desc);

alter table public.nowpayments_deposit_orders enable row level security;
revoke all privileges on table public.nowpayments_deposit_orders from public, anon, authenticated;
grant all privileges on table public.nowpayments_deposit_orders to service_role;

create or replace function public.operix_nowpayments_deposit_order_register_atomic(
  p_payment_id text,
  p_order_id text,
  p_user_id uuid,
  p_price_amount numeric,
  p_surcharge_amount numeric,
  p_charge_amount numeric,
  p_pay_amount numeric,
  p_pay_currency text,
  p_pay_address text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare order_row nowpayments_deposit_orders%rowtype;
begin
  if trim(coalesce(p_payment_id, '')) = '' or trim(coalesce(p_order_id, '')) = ''
     or p_price_amount is null or p_price_amount <= 0 or p_price_amount <> round(p_price_amount, 4)
     or p_surcharge_amount is null or p_surcharge_amount < 0 or p_surcharge_amount <> round(p_price_amount * 0.01, 4)
     or p_charge_amount is null or p_charge_amount <> p_price_amount + p_surcharge_amount
     or p_pay_amount is null or p_pay_amount <= 0
     or lower(trim(coalesce(p_pay_currency, ''))) <> 'usdttrc20'
     or trim(coalesce(p_pay_address, '')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_NOWPAYMENTS_PAYMENT_ORDER';
  end if;

  insert into nowpayments_deposit_orders(payment_id, order_id, user_id, price_amount, surcharge_amount, charge_amount, pay_amount, pay_currency, pay_address)
  values(trim(p_payment_id), trim(p_order_id), p_user_id, p_price_amount, p_surcharge_amount, p_charge_amount, p_pay_amount,
    lower(trim(p_pay_currency)), trim(p_pay_address))
  on conflict (payment_id) do nothing;

  select * into order_row from nowpayments_deposit_orders where payment_id = trim(p_payment_id);
  if order_row.payment_id is null or order_row.order_id <> trim(p_order_id) or order_row.user_id <> p_user_id
     or order_row.price_amount <> p_price_amount or order_row.surcharge_amount <> p_surcharge_amount
     or order_row.charge_amount <> p_charge_amount or order_row.pay_amount <> p_pay_amount
     or order_row.pay_currency <> lower(trim(p_pay_currency)) or order_row.pay_address <> trim(p_pay_address) then
    raise exception using errcode = 'P0001', message = 'NOWPAYMENTS_PAYMENT_ORDER_CONFLICT';
  end if;
  return jsonb_build_object('registered', true, 'paymentId', order_row.payment_id);
end;
$$;

create or replace function public.operix_nowpayments_deposit_credit_atomic(
  p_payment_id text,
  p_order_id text,
  p_user_id uuid,
  p_payment_status text,
  p_pay_currency text,
  p_pay_address text,
  p_price_amount numeric,
  p_charge_amount numeric,
  p_actually_paid numeric,
  p_tx_hash text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  order_row nowpayments_deposit_orders%rowtype;
  wallet_row wallet_balances%rowtype;
  transaction_row transactions%rowtype;
  before_balance numeric;
  normalized_payment_id text := trim(coalesce(p_payment_id, ''));
  normalized_hash text := trim(coalesce(p_tx_hash, ''));
begin
  if normalized_payment_id = '' or lower(trim(coalesce(p_payment_status, ''))) <> 'finished'
     or lower(trim(coalesce(p_pay_currency, ''))) <> 'usdttrc20'
     or p_price_amount is null or p_charge_amount is null or p_actually_paid is null or p_actually_paid <= 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_OR_UNFINISHED_NOWPAYMENTS_PAYMENT';
  end if;

  select * into order_row from nowpayments_deposit_orders where payment_id = normalized_payment_id for update;
  if order_row.payment_id is null or order_row.order_id <> trim(coalesce(p_order_id, ''))
     or order_row.user_id <> p_user_id or order_row.price_amount <> p_price_amount
     or order_row.charge_amount <> p_charge_amount
     or order_row.pay_currency <> lower(trim(p_pay_currency)) or order_row.pay_address <> trim(coalesce(p_pay_address, ''))
     or p_actually_paid + 0.0000001 < order_row.pay_amount then
    raise exception using errcode = 'P0001', message = 'NOWPAYMENTS_PAYMENT_DETAILS_MISMATCH';
  end if;

  if order_row.transaction_id is not null then
    select * into transaction_row from transactions where id = order_row.transaction_id;
    select * into wallet_row from wallet_balances where user_id = p_user_id;
    return jsonb_build_object('credited', false, 'duplicate', true,
      'depositAmount', order_row.price_amount, 'surchargeAmount', order_row.surcharge_amount,
      'chargeAmount', order_row.charge_amount, 'creditAmount', order_row.price_amount,
      'transaction', row_to_json(transaction_row), 'wallet', row_to_json(wallet_row));
  end if;

  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  before_balance := wallet_row.balance;
  if normalized_hash = '' then normalized_hash := 'NOWPAYMENTS:' || normalized_payment_id; end if;

  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address, tx_hash, network, created_at)
  values(p_user_id, 'deposit', 'approved', order_row.price_amount, order_row.price_amount, order_row.price_amount,
    order_row.pay_address, normalized_hash, 'TRC20', now())
  returning * into transaction_row;

  update wallet_balances set deposit_balance = deposit_balance + order_row.price_amount,
    total_deposits = total_deposits + order_row.price_amount,
    balance = deposit_balance + profit_balance + order_row.price_amount,
    usdt_balance = deposit_balance + profit_balance + order_row.price_amount,
    updated_at = now()
  where user_id = p_user_id returning * into wallet_row;

  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'deposit', 'USDT', order_row.price_amount, order_row.price_amount, before_balance,
    wallet_row.balance, 'approved', 'nowpayments_trc20_deposit', transaction_row.id::text,
    jsonb_build_object('provider', 'NOWPayments', 'paymentId', normalized_payment_id, 'orderId', order_row.order_id,
      'payCurrency', order_row.pay_currency, 'payAddress', order_row.pay_address,
      'depositAmount', order_row.price_amount, 'surchargeRatePercent', 1,
      'surchargeAmount', order_row.surcharge_amount, 'chargeAmount', order_row.charge_amount,
      'actuallyPaid', p_actually_paid, 'txHash', normalized_hash));

  update nowpayments_deposit_orders set payment_status = 'finished', transaction_id = transaction_row.id,
    tx_hash = normalized_hash, actual_paid = p_actually_paid, credited_at = now(), updated_at = now()
  where payment_id = normalized_payment_id;

  return jsonb_build_object('credited', true, 'duplicate', false,
    'depositAmount', order_row.price_amount, 'surchargeAmount', order_row.surcharge_amount,
    'chargeAmount', order_row.charge_amount, 'creditAmount', order_row.price_amount,
    'transaction', row_to_json(transaction_row), 'wallet', row_to_json(wallet_row));
end;
$$;

revoke all on function public.operix_nowpayments_deposit_order_register_atomic(text,text,uuid,numeric,numeric,numeric,numeric,text,text) from public, anon, authenticated;
revoke all on function public.operix_nowpayments_deposit_credit_atomic(text,text,uuid,text,text,text,numeric,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.operix_nowpayments_deposit_order_register_atomic(text,text,uuid,numeric,numeric,numeric,numeric,text,text) to service_role;
grant execute on function public.operix_nowpayments_deposit_credit_atomic(text,text,uuid,text,text,text,numeric,numeric,numeric,text) to service_role;

commit;
