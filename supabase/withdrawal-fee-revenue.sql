-- Recognize withdrawal fees as platform revenue only after the payout is confirmed.
-- Existing approved withdrawals are backfilled idempotently.
begin;

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

revoke all on function public.operix_admin_withdrawal_payout_paid_atomic(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.operix_admin_withdrawal_payout_paid_atomic(uuid,text,integer) to service_role;

commit;