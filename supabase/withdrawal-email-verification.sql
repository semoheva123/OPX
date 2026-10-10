-- Single-use email verification codes for user withdrawal requests.
-- Apply to production Supabase before deploying the matching application version.
begin;

create table if not exists public.withdrawal_email_codes (
  user_id uuid primary key references public.users(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  intent_hash text not null check (intent_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.withdrawal_email_codes enable row level security;
revoke all privileges on table public.withdrawal_email_codes from public, anon, authenticated;
grant all privileges on table public.withdrawal_email_codes to service_role;

create or replace function public.operix_withdrawal_email_code_issue_atomic(
  p_user_id uuid,
  p_code_hash text,
  p_intent_hash text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare changed_count integer;
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
      or p_intent_hash is null or p_intent_hash !~ '^[a-f0-9]{64}$'
      or p_expires_at is null or p_expires_at <= now()
      or p_expires_at > now() + interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'INVALID_WITHDRAWAL_EMAIL_CODE';
  end if;

  insert into public.withdrawal_email_codes(user_id, code_hash, intent_hash, expires_at, attempts, sent_at, created_at)
  select p_user_id, p_code_hash, p_intent_hash, p_expires_at, 0, now(), now()
  where exists (
    select 1 from public.users
    where id = p_user_id and is_banned = false and email_verified = true
  )
  on conflict (user_id) do update
    set code_hash = excluded.code_hash,
        intent_hash = excluded.intent_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        sent_at = now(),
        created_at = now()
    where public.withdrawal_email_codes.sent_at <= now() - interval '60 seconds';

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.operix_withdrawal_email_code_consume_atomic(
  p_user_id uuid,
  p_code_hash text,
  p_intent_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare challenge public.withdrawal_email_codes%rowtype;
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
      or p_intent_hash is null or p_intent_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  select * into challenge
  from public.withdrawal_email_codes
  where user_id = p_user_id
  for update;

  if challenge.user_id is null then return false; end if;
  if challenge.expires_at <= now() or challenge.attempts >= 5 then
    delete from public.withdrawal_email_codes where user_id = p_user_id;
    return false;
  end if;
  if challenge.intent_hash <> p_intent_hash or challenge.code_hash <> p_code_hash then
    update public.withdrawal_email_codes set attempts = attempts + 1 where user_id = p_user_id;
    return false;
  end if;

  delete from public.withdrawal_email_codes where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.operix_withdrawal_email_code_clear_atomic(
  p_user_id uuid,
  p_intent_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare removed_count integer;
begin
  if p_intent_hash is null or p_intent_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  delete from public.withdrawal_email_codes where user_id = p_user_id and intent_hash = p_intent_hash;
  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;

revoke all on function public.operix_withdrawal_email_code_issue_atomic(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.operix_withdrawal_email_code_consume_atomic(uuid, text, text) from public, anon, authenticated;
revoke all on function public.operix_withdrawal_email_code_clear_atomic(uuid, text) from public, anon, authenticated;
grant execute on function public.operix_withdrawal_email_code_issue_atomic(uuid, text, text, timestamptz) to service_role;
grant execute on function public.operix_withdrawal_email_code_consume_atomic(uuid, text, text) to service_role;
grant execute on function public.operix_withdrawal_email_code_clear_atomic(uuid, text) to service_role;

commit;
