-- Tier-specific minimum withdrawal: A1/A2 may withdraw from $10; other tiers remain at $20.
-- Apply after automatic-withdrawals.sql and withdrawal-validation-hardening.sql.
-- The server independently enforces the user's tier-specific minimum before calling this service-role RPC.
begin;

create or replace function public.operix_withdraw_atomic(
  p_user_id uuid,
  p_amount numeric,
  p_fee numeric,
  p_net_amount numeric,
  p_wallet_address text,
  p_image_url text,
  p_idempotency_key text,
  p_risk_score integer,
  p_risk_level text,
  p_risk_flags jsonb,
  p_network text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  user_row public.users%rowtype;
  wallet_row public.wallet_balances%rowtype;
  transaction_row public.transactions%rowtype;
  before_balance numeric;
  minimum_amount numeric;
  normalized_network text := upper(trim(coalesce(p_network, '')));
begin
  select * into user_row from public.users where id = p_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  minimum_amount := case when upper(coalesce(user_row.tier_code, '')) in ('A1', 'A2') then 10 else 20 end;

  if normalized_network <> 'TRC20' then
    raise exception using errcode = 'P0001', message = 'INVALID_WITHDRAWAL_NETWORK';
  end if;
  if p_amount is null or p_amount < 10 or p_amount > 100 or p_amount <> round(p_amount, 4)
      or p_fee is null or p_fee < 0 or p_fee <> round(p_amount * 0.10, 4)
      or p_net_amount is null or p_net_amount <= 0 or p_net_amount <> round(p_amount - p_fee, 4) then
    raise exception using errcode = 'P0001', message = 'INVALID_WITHDRAWAL_AMOUNT';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_wallet_address is null or length(trim(p_wallet_address)) < 34 or length(trim(p_wallet_address)) > 36 then
    raise exception using errcode = 'P0001', message = 'INVALID_WITHDRAWAL_DESTINATION';
  end if;

  select * into transaction_row
    from public.transactions
    where user_id = p_user_id and type = 'withdraw' and idempotency_key = p_idempotency_key
    limit 1;
  if transaction_row.id is not null then
    if transaction_row.amount <> p_amount or transaction_row.fee_amount <> p_fee or transaction_row.net_amount <> p_net_amount
        or transaction_row.wallet_address <> trim(p_wallet_address) or transaction_row.network <> normalized_network then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('duplicate', true, 'transaction', row_to_json(transaction_row));
  end if;

  if p_amount < minimum_amount then
    raise exception using errcode = 'P0001', message = 'INVALID_WITHDRAWAL_AMOUNT';
  end if;

  select * into wallet_row from public.wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if wallet_row.profit_balance < p_amount then raise exception using errcode = 'P0001', message = 'INSUFFICIENT_PROFIT'; end if;
  before_balance := wallet_row.balance;
  update public.wallet_balances
    set profit_balance = profit_balance - p_amount,
        total_withdrawn = total_withdrawn + p_amount,
        balance = deposit_balance + profit_balance - p_amount,
        updated_at = now()
    where user_id = p_user_id;
  insert into public.transactions (user_id, type, status, amount, fee_amount, net_amount, wallet_address, network, idempotency_key, risk_score, risk_level, risk_flags)
    values (p_user_id, 'withdraw', 'pending', p_amount, p_fee, p_net_amount, trim(p_wallet_address), normalized_network,
      p_idempotency_key, p_risk_score, p_risk_level, coalesce(p_risk_flags, '[]'::jsonb))
    returning * into transaction_row;
  insert into public.financial_ledger (user_id, type, currency, amount, fee_amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
    values (p_user_id, 'withdraw', 'USDT', p_amount, p_fee, p_net_amount, before_balance, before_balance - p_amount, 'pending',
      'withdrawal_request', transaction_row.id::text,
      jsonb_build_object('walletAddress', p_wallet_address, 'network', normalized_network, 'riskLevel', p_risk_level));
  return jsonb_build_object('duplicate', false, 'transaction', row_to_json(transaction_row),
    'wallet', (select row_to_json(w) from public.wallet_balances w where w.user_id = p_user_id));
end;
$$;

revoke all on function public.operix_withdraw_atomic(uuid, numeric, numeric, numeric, text, text, text, integer, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.operix_withdraw_atomic(uuid, numeric, numeric, numeric, text, text, text, integer, text, jsonb, text)
  to service_role;

commit;
