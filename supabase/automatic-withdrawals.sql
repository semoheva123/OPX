-- Automatic, admin-triggered USDT payouts. Apply after schema.sql.
-- The signer private keys remain in the hosting environment; signed payloads are AES-GCM encrypted before storage.
begin;

alter table public.transactions add column if not exists network text;

drop function if exists public.operix_withdraw_atomic(uuid, numeric, numeric, numeric, text, text, text, integer, text, jsonb);
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
  wallet_row wallet_balances%rowtype;
  transaction_row transactions%rowtype;
  before_balance numeric;
  normalized_network text := upper(trim(coalesce(p_network, '')));
begin
  if normalized_network <> 'TRC20' then raise exception using errcode = 'P0001', message = 'INVALID_WITHDRAWAL_NETWORK'; end if;
  if p_amount is null or p_amount < 20 or p_amount > 5000 or p_amount <> round(p_amount, 4)
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
  if exists (select 1 from transactions where user_id = p_user_id and type = 'withdraw' and idempotency_key = p_idempotency_key) then
    select * into transaction_row from transactions where user_id = p_user_id and type = 'withdraw' and idempotency_key = p_idempotency_key limit 1;
    if transaction_row.amount <> p_amount or transaction_row.fee_amount <> p_fee or transaction_row.net_amount <> p_net_amount
        or transaction_row.wallet_address <> trim(p_wallet_address) or transaction_row.network <> normalized_network then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('duplicate', true, 'transaction', row_to_json(transaction_row));
  end if;
  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if wallet_row.profit_balance < p_amount then raise exception using errcode = 'P0001', message = 'INSUFFICIENT_PROFIT'; end if;
  before_balance := wallet_row.balance;
  update wallet_balances set profit_balance = profit_balance - p_amount, total_withdrawn = total_withdrawn + p_amount,
    balance = deposit_balance + profit_balance - p_amount, updated_at = now() where user_id = p_user_id;
  insert into transactions (user_id, type, status, amount, fee_amount, net_amount, wallet_address, network, idempotency_key, risk_score, risk_level, risk_flags)
  values (p_user_id, 'withdraw', 'pending', p_amount, p_fee, p_net_amount, trim(p_wallet_address), normalized_network,
    nullif(p_idempotency_key, ''), p_risk_score, p_risk_level, coalesce(p_risk_flags, '[]'::jsonb)) returning * into transaction_row;
  insert into financial_ledger (user_id, type, currency, amount, fee_amount, net_amount, balance_before, balance_after, status, source, reference_id, metadata)
  values (p_user_id, 'withdraw', 'USDT', p_amount, p_fee, p_net_amount, before_balance, before_balance - p_amount, 'pending',
    'withdrawal_request', transaction_row.id::text, jsonb_build_object('walletAddress', p_wallet_address, 'network', normalized_network, 'riskLevel', p_risk_level));
  return jsonb_build_object('duplicate', false, 'transaction', row_to_json(transaction_row), 'wallet', (select row_to_json(w) from wallet_balances w where w.user_id = p_user_id));
end;
$$;
revoke all on function public.operix_withdraw_atomic(uuid, numeric, numeric, numeric, text, text, text, integer, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.operix_withdraw_atomic(uuid, numeric, numeric, numeric, text, text, text, integer, text, jsonb, text) to service_role;

create table if not exists public.withdrawal_payouts (
  id uuid primary key default uuid_generate_v4(),
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  admin_user_id uuid references public.users(id) on delete set null,
  network text not null check (network in ('TRC20','BEP20')),
  recipient text not null,
  sender_address text not null default '',
  amount numeric(18,6) not null check (amount > 0),
  status text not null default 'preparing' check (status in ('preparing','broadcast','paid','failed','manual_review','cancelled')),
  tx_hash text unique,
  signed_payload text,
  payload_expires_at timestamptz,
  broadcast_attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists withdrawal_payouts_queue_idx on public.withdrawal_payouts(status, next_attempt_at);
alter table public.withdrawal_payouts enable row level security;
revoke all privileges on table public.withdrawal_payouts from public, anon, authenticated;
grant all privileges on table public.withdrawal_payouts to service_role;

alter table public.financial_ledger drop constraint if exists financial_ledger_type_check;
alter table public.financial_ledger add constraint financial_ledger_type_check
  check (type in ('deposit','withdraw','reward','staking_reward','referral_commission','upgrade_deduction','token_burn','vault_lock','vault_release','vault_early_release','vault_penalty','admin_adjustment','withdrawal_fee_income'));
create unique index if not exists financial_ledger_withdrawal_fee_revenue_ref_idx
  on public.financial_ledger(reference_id) where source = 'withdrawal_fee_revenue';

insert into public.financial_ledger(user_id,type,currency,amount,fee_amount,net_amount,balance_before,balance_after,status,source,reference_id,notes,metadata,created_at)
select tx.user_id,'withdrawal_fee_income','USDT',tx.fee_amount,0,tx.fee_amount,0,0,'approved','withdrawal_fee_revenue',tx.id::text,
  'Withdrawal fee recognized after payout confirmation',
  jsonb_build_object('transactionAmount',tx.amount,'payoutNetAmount',tx.net_amount,'txHash',tx.tx_hash),
  coalesce(tx.updated_at,tx.created_at,now())
from public.transactions tx
where tx.type='withdraw' and tx.status='approved' and tx.fee_amount>0
on conflict (reference_id) where source='withdrawal_fee_revenue' do nothing;

create or replace function public.operix_admin_withdrawal_claim_atomic(p_transaction_id uuid, p_admin_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tx transactions%rowtype; payout withdrawal_payouts%rowtype; actor users%rowtype;
begin
  select * into actor from users where id = p_admin_user_id and is_banned = false;
  if actor.id is null or actor.role not in ('admin','financial_admin') then raise exception using errcode = '42501', message = 'FINANCE_PERMISSION_REQUIRED'; end if;
  select * into tx from transactions where id = p_transaction_id for update;
  if tx.id is null or tx.type <> 'withdraw' then raise exception using errcode = 'P0002', message = 'WITHDRAWAL_NOT_FOUND'; end if;
  select * into payout from withdrawal_payouts where transaction_id = tx.id for update;
  if payout.id is not null then
    if payout.status = 'paid' then return jsonb_build_object('duplicate', true, 'payout', row_to_json(payout), 'transaction', row_to_json(tx)); end if;
    if payout.status in ('broadcast','manual_review','cancelled') or (payout.status = 'failed' and payout.tx_hash is not null) then
      return jsonb_build_object('duplicate', true, 'payout', row_to_json(payout), 'transaction', row_to_json(tx));
    end if;
    if tx.status <> 'pending' then raise exception using errcode = 'P0001', message = 'WITHDRAWAL_NOT_PENDING'; end if;
    if payout.status = 'failed' then update withdrawal_payouts set status = 'preparing', admin_user_id = p_admin_user_id, last_error = '', updated_at = now() where id = payout.id returning * into payout; end if;
  else
    if tx.status <> 'pending' then raise exception using errcode = 'P0001', message = 'WITHDRAWAL_NOT_PENDING'; end if;
    if tx.network <> 'TRC20' or trim(tx.wallet_address) = '' or tx.net_amount <= 0 then raise exception using errcode = 'P0001', message = 'WITHDRAWAL_DESTINATION_INCOMPLETE'; end if;
    insert into withdrawal_payouts(transaction_id, admin_user_id, network, recipient, amount, status)
      values(tx.id, p_admin_user_id, tx.network, tx.wallet_address, tx.net_amount, 'preparing') returning * into payout;
  end if;
  insert into audit_logs(action, entity, actor_id, metadata, created_at)
    values('withdrawal_payout_claimed', tx.id::text, p_admin_user_id, jsonb_build_object('network', payout.network, 'amount', payout.amount, 'recipient', payout.recipient), now());
  return jsonb_build_object('duplicate', false, 'payout', row_to_json(payout), 'transaction', row_to_json(tx));
end;
$$;

create or replace function public.operix_admin_withdrawal_payout_recover_stale_preparing_atomic(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype;
begin
  update withdrawal_payouts set status='failed', last_error='PREPARATION_WORKER_EXPIRED_BEFORE_SIGNED_TRANSACTION_WAS_STORED', updated_at=now()
    where transaction_id=p_transaction_id and status='preparing' and tx_hash is null
      and updated_at < now() - interval '5 minutes'
      and exists (select 1 from transactions where id=p_transaction_id and type='withdraw' and status='pending')
    returning * into payout;
  if payout.id is not null then
    insert into audit_logs(action,entity,metadata,created_at)
      values('withdrawal_payout_stale_preparation_recovered',p_transaction_id::text,
        jsonb_build_object('status','failed','hasTxHash',false),now());
  end if;
  if payout.id is null then return null; end if;
  return row_to_json(payout)::jsonb;
end;
$$;

create or replace function public.operix_admin_withdrawal_record_broadcast_atomic(
  p_transaction_id uuid, p_admin_user_id uuid, p_tx_hash text, p_sender_address text,
  p_signed_payload text, p_payload_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype; actor users%rowtype;
begin
  select * into actor from users where id = p_admin_user_id and is_banned = false;
  if actor.id is null or actor.role not in ('admin','financial_admin') then raise exception using errcode = '42501', message = 'FINANCE_PERMISSION_REQUIRED'; end if;
  select * into payout from withdrawal_payouts where transaction_id = p_transaction_id for update;
  if payout.id is null then raise exception using errcode = 'P0002', message = 'PAYOUT_NOT_FOUND'; end if;
  if payout.status <> 'preparing' or payout.tx_hash is not null then raise exception using errcode = 'P0001', message = 'PAYOUT_ALREADY_PREPARED'; end if;
  if trim(coalesce(p_tx_hash,'')) = '' or trim(coalesce(p_signed_payload,'')) = '' then raise exception using errcode = 'P0001', message = 'INVALID_SIGNED_PAYOUT'; end if;
  update withdrawal_payouts set status='broadcast', tx_hash=lower(trim(p_tx_hash)), sender_address=trim(p_sender_address),
    signed_payload=p_signed_payload, payload_expires_at=p_payload_expires_at, broadcast_attempts=0, next_attempt_at=now(), updated_at=now()
    where id=payout.id returning * into payout;
  insert into audit_logs(action, entity, actor_id, metadata, created_at)
    values('withdrawal_payout_signed', p_transaction_id::text, p_admin_user_id,
      jsonb_build_object('network', payout.network, 'amount', payout.amount, 'txHash', payout.tx_hash, 'senderAddress', payout.sender_address), now());
  return row_to_json(payout);
end;
$$;

create or replace function public.operix_admin_withdrawal_payout_retry_atomic(p_transaction_id uuid, p_error text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype;
begin
  select * into payout from withdrawal_payouts where transaction_id=p_transaction_id for update;
  if payout.id is null or payout.status <> 'broadcast' then raise exception using errcode = 'P0001', message = 'PAYOUT_NOT_BROADCAST'; end if;
  update withdrawal_payouts set broadcast_attempts=broadcast_attempts+1,
    next_attempt_at=now() + least(3600, power(2, least(broadcast_attempts, 10))::integer) * interval '1 second',
    last_error=left(coalesce(p_error,''),500), updated_at=now() where id=payout.id returning * into payout;
  return row_to_json(payout);
end;
$$;

create or replace function public.operix_admin_withdrawal_payout_defer_atomic(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype;
begin
  update withdrawal_payouts set next_attempt_at=now()+interval '1 minute', updated_at=now()
    where transaction_id=p_transaction_id and status='broadcast' returning * into payout;
  if payout.id is null then raise exception using errcode='P0001', message='PAYOUT_NOT_BROADCAST'; end if;
  return row_to_json(payout);
end;
$$;

create or replace function public.operix_admin_withdrawal_payout_failed_atomic(p_transaction_id uuid, p_tx_hash text default null, p_error text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype;
begin
  select * into payout from withdrawal_payouts where transaction_id=p_transaction_id for update;
  if payout.id is null or payout.status not in ('preparing','broadcast','manual_review') then raise exception using errcode = 'P0001', message = 'PAYOUT_NOT_ACTIVE'; end if;
  if payout.tx_hash is not null and (p_tx_hash is null or lower(payout.tx_hash) <> lower(p_tx_hash)) then raise exception using errcode = 'P0001', message = 'PAYOUT_HASH_MISMATCH'; end if;
  update withdrawal_payouts set status='failed', signed_payload=null, next_attempt_at=now(), last_error=left(coalesce(p_error,''),500), updated_at=now()
    where id=payout.id returning * into payout;
  insert into audit_logs(action, entity, metadata, created_at)
    values('withdrawal_payout_failed', p_transaction_id::text, jsonb_build_object('txHash', payout.tx_hash, 'error', payout.last_error), now());
  return row_to_json(payout);
end;
$$;

create or replace function public.operix_admin_withdrawal_payout_manual_review_atomic(p_transaction_id uuid, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype;
begin
  select * into payout from withdrawal_payouts where transaction_id=p_transaction_id for update;
  if payout.id is null or payout.status <> 'broadcast' then raise exception using errcode = 'P0001', message = 'PAYOUT_NOT_BROADCAST'; end if;
  update withdrawal_payouts set status='manual_review', last_error=left(coalesce(p_error,''),500), updated_at=now()
    where id=payout.id returning * into payout;
  insert into audit_logs(action, entity, metadata, created_at)
    values('withdrawal_payout_manual_review', p_transaction_id::text, jsonb_build_object('txHash', payout.tx_hash, 'error', payout.last_error), now());
  return row_to_json(payout);
end;
$$;

create or replace function public.operix_admin_withdrawal_payout_resume_atomic(p_transaction_id uuid, p_admin_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype; actor users%rowtype;
begin
  select * into actor from users where id=p_admin_user_id and is_banned=false;
  if actor.id is null or actor.role not in ('admin','financial_admin') then raise exception using errcode='42501', message='FINANCE_PERMISSION_REQUIRED'; end if;
  select * into payout from withdrawal_payouts where transaction_id=p_transaction_id for update;
  if payout.id is null or payout.status <> 'manual_review' or payout.signed_payload is null or payout.tx_hash is null then
    raise exception using errcode='P0001', message='PAYOUT_NOT_RESUMABLE';
  end if;
  if not exists (select 1 from transactions where id=p_transaction_id and type='withdraw' and status='pending') then
    raise exception using errcode='P0001', message='WITHDRAWAL_NOT_PENDING';
  end if;
  update withdrawal_payouts set status='broadcast', broadcast_attempts=0, next_attempt_at=now(), last_error='', updated_at=now()
    where id=payout.id returning * into payout;
  insert into audit_logs(action,entity,actor_id,metadata,created_at)
    values('withdrawal_payout_same_hash_resumed',p_transaction_id::text,p_admin_user_id,
      jsonb_build_object('txHash',payout.tx_hash,'network',payout.network),now());
  return row_to_json(payout);
end;
$$;

create or replace function public.operix_admin_withdrawal_payout_paid_atomic(p_transaction_id uuid, p_tx_hash text, p_confirmations integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare payout withdrawal_payouts%rowtype; tx transactions%rowtype;
begin
  select * into payout from withdrawal_payouts where transaction_id=p_transaction_id for update;
  if payout.id is null or payout.status not in ('broadcast','paid') then raise exception using errcode = 'P0001', message = 'PAYOUT_NOT_BROADCAST'; end if;
  if lower(payout.tx_hash) <> lower(p_tx_hash) then raise exception using errcode = 'P0001', message = 'PAYOUT_HASH_MISMATCH'; end if;
  select * into tx from transactions where id=p_transaction_id for update;
  if tx.status = 'approved' and payout.status = 'paid' then return jsonb_build_object('duplicate', true, 'payout', row_to_json(payout), 'transaction', row_to_json(tx)); end if;
  if tx.status <> 'pending' then raise exception using errcode = 'P0001', message = 'WITHDRAWAL_NOT_PENDING'; end if;
  update withdrawal_payouts set status='paid', signed_payload=null, last_error='', updated_at=now() where id=payout.id returning * into payout;
  update transactions set status='approved', tx_hash=payout.tx_hash, network=payout.network, updated_at=now() where id=tx.id returning * into tx;
  update financial_ledger set status='approved', metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('network',payout.network,'txHash',payout.tx_hash,'senderAddress',payout.sender_address,'confirmations',p_confirmations)
    where reference_id=tx.id::text and source='withdrawal_request';
  if tx.fee_amount > 0 then
    insert into financial_ledger(user_id,type,currency,amount,fee_amount,net_amount,balance_before,balance_after,status,source,reference_id,notes,metadata)
      values(tx.user_id,'withdrawal_fee_income','USDT',tx.fee_amount,0,tx.fee_amount,0,0,'approved','withdrawal_fee_revenue',tx.id::text,
        'Withdrawal fee recognized after payout confirmation',
        jsonb_build_object('transactionAmount',tx.amount,'payoutNetAmount',tx.net_amount,'txHash',payout.tx_hash,'network',payout.network))
      on conflict (reference_id) where source='withdrawal_fee_revenue' do nothing;
  end if;
  insert into audit_logs(action, entity, metadata, created_at)
    values('withdrawal_payout_paid', tx.id::text, jsonb_build_object('network',payout.network,'amount',payout.amount,'txHash',payout.tx_hash,'confirmations',p_confirmations), now());
  return jsonb_build_object('duplicate', false, 'payout', row_to_json(payout), 'transaction', row_to_json(tx));
end;
$$;

create or replace function public.operix_admin_withdrawal_reject_atomic(p_transaction_id uuid, p_admin_user_id uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare tx transactions%rowtype; payout withdrawal_payouts%rowtype; wallet_row wallet_balances%rowtype; actor users%rowtype; before_balance numeric;
begin
  select * into actor from users where id=p_admin_user_id and is_banned=false;
  if actor.id is null or actor.role not in ('admin','financial_admin') then raise exception using errcode='42501', message='FINANCE_PERMISSION_REQUIRED'; end if;
  select * into tx from transactions where id=p_transaction_id for update;
  if tx.id is null or tx.type <> 'withdraw' then raise exception using errcode='P0002', message='WITHDRAWAL_NOT_FOUND'; end if;
  if tx.status <> 'pending' then raise exception using errcode='P0001', message='PROCESSED'; end if;
  select * into payout from withdrawal_payouts where transaction_id=tx.id for update;
  if payout.id is not null and payout.status not in ('failed','cancelled') then raise exception using errcode='P0001', message='PAYOUT_MAY_HAVE_BEEN_SENT'; end if;
  select * into wallet_row from wallet_balances where user_id=tx.user_id for update;
  if wallet_row.id is null then raise exception using errcode='P0002', message='USER_WALLET_NOT_FOUND'; end if;
  before_balance := wallet_row.balance;
  update wallet_balances set profit_balance=profit_balance+tx.amount, total_withdrawn=greatest(total_withdrawn-tx.amount,0),
    balance=deposit_balance+profit_balance+tx.amount, updated_at=now() where user_id=tx.user_id;
  update transactions set status='rejected', updated_at=now() where id=tx.id returning * into tx;
  if payout.id is not null then update withdrawal_payouts set status='cancelled', signed_payload=null, updated_at=now() where id=payout.id returning * into payout; end if;
  update financial_ledger set status='rejected', metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('adminNote',left(coalesce(p_note,''),500))
    where reference_id=tx.id::text and source='withdrawal_request';
  insert into financial_ledger(user_id,type,currency,amount,net_amount,balance_before,balance_after,status,source,reference_id,metadata)
    values(tx.user_id,'withdraw','USDT',tx.amount,tx.amount,before_balance,before_balance+tx.amount,'approved','withdrawal_rejection_refund',tx.id::text,
      jsonb_build_object('adminUserId',p_admin_user_id,'note',left(coalesce(p_note,''),500)));
  insert into audit_logs(action,entity,actor_id,metadata,created_at)
    values('transaction_reject',tx.id::text,p_admin_user_id,jsonb_build_object('type','withdraw','amount',tx.amount,'note',left(coalesce(p_note,''),500)),now());
  return jsonb_build_object('transaction',row_to_json(tx),'wallet',(select row_to_json(w) from wallet_balances w where w.user_id=tx.user_id));
end;
$$;

revoke all on function public.operix_admin_withdrawal_claim_atomic(uuid,uuid) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_payout_recover_stale_preparing_atomic(uuid) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_record_broadcast_atomic(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_payout_retry_atomic(uuid,text) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_payout_defer_atomic(uuid) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_payout_failed_atomic(uuid,text,text) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_payout_manual_review_atomic(uuid,text) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_payout_resume_atomic(uuid,uuid) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_payout_paid_atomic(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.operix_admin_withdrawal_reject_atomic(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.operix_admin_withdrawal_claim_atomic(uuid,uuid) to service_role;
grant execute on function public.operix_admin_withdrawal_payout_recover_stale_preparing_atomic(uuid) to service_role;
grant execute on function public.operix_admin_withdrawal_record_broadcast_atomic(uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.operix_admin_withdrawal_payout_retry_atomic(uuid,text) to service_role;
grant execute on function public.operix_admin_withdrawal_payout_defer_atomic(uuid) to service_role;
grant execute on function public.operix_admin_withdrawal_payout_failed_atomic(uuid,text,text) to service_role;
grant execute on function public.operix_admin_withdrawal_payout_manual_review_atomic(uuid,text) to service_role;
grant execute on function public.operix_admin_withdrawal_payout_resume_atomic(uuid,uuid) to service_role;
grant execute on function public.operix_admin_withdrawal_payout_paid_atomic(uuid,text,integer) to service_role;
grant execute on function public.operix_admin_withdrawal_reject_atomic(uuid,uuid,text) to service_role;

commit;
