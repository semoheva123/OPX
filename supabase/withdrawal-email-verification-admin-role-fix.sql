-- Forward-only fix: allow verified administrative accounts to receive the email OTP
-- when they use the user-facing withdrawal form. Admin sign-in still requires TOTP.
begin;

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

revoke all on function public.operix_withdrawal_email_code_issue_atomic(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.operix_withdrawal_email_code_issue_atomic(uuid, text, text, timestamptz)
  to service_role;

commit;
