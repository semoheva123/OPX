-- Switch new NOWPayments deposits to a fixed 1 USDT fee.
-- Existing payment orders and balances are intentionally left unchanged.
begin;

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
declare
  order_row nowpayments_deposit_orders%rowtype;
begin
  if trim(coalesce(p_payment_id, '')) = '' or trim(coalesce(p_order_id, '')) = ''
      or p_user_id is null or p_price_amount is null or p_price_amount <= 0 or p_price_amount > 999999
      or p_price_amount <> trunc(p_price_amount)
     or p_surcharge_amount is null or p_surcharge_amount <> 1.0000
     or p_charge_amount is null or p_charge_amount <> p_price_amount + 1.0000
      or p_pay_amount is null or p_pay_amount <> p_charge_amount
     or lower(trim(coalesce(p_pay_currency, ''))) <> 'usdttrc20'
     or trim(coalesce(p_pay_address, '')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_NOWPAYMENTS_FIXED_FEE_ORDER';
  end if;

  insert into nowpayments_deposit_orders(payment_id, order_id, user_id, price_amount, surcharge_amount,
    charge_amount, pay_amount, pay_currency, pay_address)
  values(trim(p_payment_id), trim(p_order_id), p_user_id, p_price_amount, p_surcharge_amount,
    p_charge_amount, p_pay_amount, lower(trim(p_pay_currency)), trim(p_pay_address))
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
  credit_amount numeric := least(p_actually_paid, p_price_amount);
begin
  if normalized_payment_id = '' or lower(trim(coalesce(p_payment_status, ''))) <> 'finished'
     or lower(trim(coalesce(p_pay_currency, ''))) <> 'usdttrc20'
     or p_price_amount is null or p_charge_amount is null
     or p_actually_paid is null or p_actually_paid <= 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_OR_UNFINISHED_NOWPAYMENTS_PAYMENT';
  end if;

  select * into order_row from nowpayments_deposit_orders where payment_id = normalized_payment_id for update;
  if order_row.payment_id is null or order_row.order_id <> trim(coalesce(p_order_id, ''))
     or order_row.user_id <> p_user_id or order_row.price_amount <> p_price_amount
     or order_row.charge_amount <> p_charge_amount
     or order_row.pay_currency <> lower(trim(p_pay_currency))
     or order_row.pay_address <> trim(coalesce(p_pay_address, '')) then
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
  if wallet_row.id is null then
    raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND';
  end if;
  before_balance := wallet_row.balance;
  if normalized_hash = '' then normalized_hash := 'NOWPAYMENTS:' || normalized_payment_id; end if;

  insert into transactions(user_id, type, status, amount, gross_amount, usdt_amount, wallet_address, tx_hash, network, created_at)
  values(p_user_id, 'deposit', 'approved', credit_amount, credit_amount, credit_amount,
    order_row.pay_address, normalized_hash, 'TRC20', now())
  returning * into transaction_row;

  update wallet_balances set deposit_balance = deposit_balance + credit_amount,
    total_deposits = total_deposits + credit_amount,
    balance = deposit_balance + profit_balance + credit_amount,
    usdt_balance = deposit_balance + profit_balance + credit_amount,
    updated_at = now()
  where user_id = p_user_id returning * into wallet_row;

  insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values(p_user_id, 'deposit', 'USDT', credit_amount, credit_amount, before_balance,
    wallet_row.balance, 'approved', 'nowpayments_trc20_deposit', transaction_row.id::text,
    jsonb_build_object('provider', 'NOWPayments', 'paymentId', normalized_payment_id, 'orderId', order_row.order_id,
      'payCurrency', order_row.pay_currency, 'payAddress', order_row.pay_address,
      'depositAmount', credit_amount, 'surchargeAmount', order_row.surcharge_amount,
      'chargeAmount', order_row.charge_amount, 'actuallyPaid', p_actually_paid,
      'creditAmount', credit_amount, 'txHash', normalized_hash));

  if order_row.surcharge_amount > 0 then
    insert into financial_ledger(user_id, type, currency, amount, net_amount, balance_before, balance_after, status, source, reference_id, notes, metadata)
    values(p_user_id, 'deposit_fee_income', 'USDT', order_row.surcharge_amount, order_row.surcharge_amount, 0, 0, 'approved',
      'nowpayments_deposit_surcharge', transaction_row.id::text, 'NOWPayments deposit fee collected',
      jsonb_build_object('paymentId', normalized_payment_id, 'orderId', order_row.order_id,
        'depositAmount', order_row.price_amount, 'surchargeAmount', order_row.surcharge_amount,
        'chargeAmount', order_row.charge_amount, 'txHash', normalized_hash))
    on conflict(reference_id) where source = 'nowpayments_deposit_surcharge' do nothing;
  end if;

  update nowpayments_deposit_orders set payment_status = 'finished', transaction_id = transaction_row.id,
    tx_hash = normalized_hash, actual_paid = p_actually_paid, credited_at = now(), updated_at = now()
  where payment_id = normalized_payment_id;

  return jsonb_build_object('credited', true, 'duplicate', false,
    'depositAmount', order_row.price_amount, 'surchargeAmount', order_row.surcharge_amount,
    'chargeAmount', order_row.charge_amount, 'creditAmount', credit_amount,
    'transaction', row_to_json(transaction_row), 'wallet', row_to_json(wallet_row));
end;
$$;

revoke all on function public.operix_nowpayments_deposit_order_register_atomic(text,text,uuid,numeric,numeric,numeric,numeric,text,text)
  from public, anon, authenticated;
revoke all on function public.operix_nowpayments_deposit_credit_atomic(text,text,uuid,text,text,text,numeric,numeric,numeric,text)
  from public, anon, authenticated;
grant execute on function public.operix_nowpayments_deposit_order_register_atomic(text,text,uuid,numeric,numeric,numeric,numeric,text,text)
  to service_role;
grant execute on function public.operix_nowpayments_deposit_credit_atomic(text,text,uuid,text,text,text,numeric,numeric,numeric,text)
  to service_role;

commit;