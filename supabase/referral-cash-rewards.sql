begin;

create table if not exists public.referral_reward_awards (
  id uuid primary key default uuid_generate_v4(),
  referrer_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  level_number integer not null check (level_number between 1 and 3),
  tier_code text not null,
  amount numeric(18,4) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (referred_user_id, level_number)
);

create index if not exists referral_reward_awards_referrer_created_idx
  on public.referral_reward_awards (referrer_id, created_at desc);

create or replace function public.operix_upgrade_atomic(
  p_user_id uuid,
  p_expected_tier text,
  p_target_tier text,
  p_upgrade_cost numeric,
  p_usdt_amount numeric,
  p_opx_amount numeric,
  p_opx_value numeric,
  p_referrer_id uuid,
  p_referral_commission numeric,
  p_target_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row users%rowtype;
  wallet_row wallet_balances%rowtype;
  ref_wallet wallet_balances%rowtype;
  upgrade_row transactions%rowtype;
  before_balance numeric;
  target_level_number integer;
  reward_amount numeric(18,4) := 0;
  reward_awarded numeric(18,4) := 0;
  referrer_balance numeric(18,4) := 0;
  trusted_referrer_id uuid;
begin
  select * into user_row from users where id = p_user_id for update;
  if user_row.id is null then raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND'; end if;
  if user_row.tier_code is distinct from p_expected_tier then raise exception using errcode = 'P0001', message = 'TIER_CHANGED'; end if;

  select ranked.level_number into target_level_number
  from (
    select code, row_number() over (order by price asc, code asc)::integer as level_number
    from vip_levels
  ) ranked
  where ranked.code = p_target_tier;
  if target_level_number is null then raise exception using errcode = 'P0002', message = 'VIP_LEVEL_NOT_FOUND'; end if;
  reward_amount := case target_level_number when 1 then 1 when 2 then 2 when 3 then 5 else 0 end;

  select * into wallet_row from wallet_balances where user_id = p_user_id for update;
  if wallet_row.id is null then raise exception using errcode = 'P0002', message = 'USER_WALLET_NOT_FOUND'; end if;
  if wallet_row.deposit_balance < p_usdt_amount then raise exception using errcode = 'P0001', message = 'INSUFFICIENT_DEPOSIT'; end if;
  before_balance := wallet_row.balance;

  update users set tier_code = p_target_tier, updated_at = now() where id = p_user_id;
  update wallet_balances
  set deposit_balance = deposit_balance - p_usdt_amount,
      opx_balance = opx_balance - p_opx_amount,
      balance = deposit_balance - p_usdt_amount + profit_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into transactions(user_id,type,status,amount,gross_amount,usdt_amount,opx_amount,wallet_address)
  values(p_user_id,'upgrade_deduction','approved',p_upgrade_cost,p_upgrade_cost,p_usdt_amount,p_opx_amount,'Upgrade to ' || p_target_name)
  returning * into upgrade_row;
  if p_opx_amount > 0 then
    insert into transactions(user_id,type,status,amount,gross_amount,opx_amount,wallet_address)
    values(p_user_id,'token_burn','approved',p_opx_value,p_opx_value,p_opx_amount,'Burn OPX for ' || p_target_name);
  end if;
  insert into financial_ledger(user_id,type,currency,amount,net_amount,balance_before,balance_after,status,source,reference_id)
  values(p_user_id,'upgrade_deduction','USDT',p_upgrade_cost,p_usdt_amount,before_balance,before_balance-p_usdt_amount,'approved','tier_upgrade',upgrade_row.id::text);

  if p_referrer_id is not null and user_row.referred_by is not null and p_referrer_id <> p_user_id then
    select id into trusted_referrer_id
    from users
    where id = p_referrer_id and upper(trim(referral_code)) = upper(trim(user_row.referred_by))
    for update;
  end if;

  if trusted_referrer_id is not null and reward_amount > 0 and p_upgrade_cost > 0 then
    select * into ref_wallet from wallet_balances where user_id = trusted_referrer_id for update;
    if ref_wallet.id is not null then
      insert into referral_reward_awards(referrer_id,referred_user_id,level_number,tier_code,amount)
      values(trusted_referrer_id,p_user_id,target_level_number,p_target_tier,reward_amount)
      on conflict (referred_user_id,level_number) do nothing
      returning amount into reward_awarded;

      if reward_awarded is not null then
        update wallet_balances
        set profit_balance = profit_balance + reward_awarded,
            balance = deposit_balance + profit_balance + reward_awarded,
            usdt_balance = deposit_balance + profit_balance + reward_awarded,
            updated_at = now()
        where user_id = trusted_referrer_id
        returning balance into referrer_balance;

        insert into transactions(user_id,type,status,amount,gross_amount,usdt_amount,wallet_address)
        values(trusted_referrer_id,'referral_commission','approved',reward_awarded,reward_awarded,reward_awarded,'Referral activation reward from ' || user_row.email);
        insert into financial_ledger(user_id,type,currency,amount,net_amount,balance_before,balance_after,status,source,reference_id,notes)
        values(trusted_referrer_id,'referral_commission','USDT',reward_awarded,reward_awarded,ref_wallet.balance,referrer_balance,'approved','referral_tier_activation',upgrade_row.id::text,'Tier ' || target_level_number::text || ' referral activation reward');
        insert into notifications(user_id,title,body,type)
        values(trusted_referrer_id,'مكافأة إحالة جديدة','تمت إضافة $' || to_char(reward_awarded,'FM999999990.00') || ' إلى رصيد أرباحك بعد تفعيل إحالتك المباشرة للمستوى ' || target_level_number::text || '.','transaction');
      else
        select balance into referrer_balance from wallet_balances where user_id = trusted_referrer_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'user',(select row_to_json(u) from users u where u.id=p_user_id),
    'wallet',(select row_to_json(w) from wallet_balances w where w.user_id=p_user_id),
    'referralRewardAwarded',coalesce(reward_awarded,0),
    'referrerBalance',coalesce(referrer_balance,0)
  );
end;
$$;

revoke execute on function public.operix_upgrade_atomic(uuid,text,text,numeric,numeric,numeric,numeric,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.operix_upgrade_atomic(uuid,text,text,numeric,numeric,numeric,numeric,uuid,numeric,text) to service_role;

commit;
