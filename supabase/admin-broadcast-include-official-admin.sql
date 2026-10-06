-- Include the verified official OPERIX admin account in platform update campaigns.
-- Ordinary users remain eligible under the existing verified/active/opted-in rules.
begin;

create or replace function public.operix_create_email_broadcast_atomic(
  p_subject text,
  p_body text,
  p_created_by uuid,
  p_recipients jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.users%rowtype;
  campaign public.email_broadcasts%rowtype;
  inserted_count integer;
  requested_count integer;
begin
  select * into actor from public.users where id = p_created_by and is_banned = false;
  if actor.id is null or actor.role <> 'admin' then
    raise exception using errcode = '42501', message = 'BROADCAST_PERMISSION_REQUIRED';
  end if;
  if p_subject is null or char_length(btrim(p_subject)) not between 1 and 150
      or p_body is null or char_length(btrim(p_body)) not between 1 and 5000 then
    raise exception using errcode = 'P0001', message = 'INVALID_EMAIL_BROADCAST_CONTENT';
  end if;
  if jsonb_typeof(p_recipients) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_EMAIL_BROADCAST_RECIPIENTS';
  end if;
  requested_count := jsonb_array_length(p_recipients);
  if requested_count < 1 or requested_count > 10000 then
    raise exception using errcode = 'P0001', message = 'EMAIL_BROADCAST_RECIPIENT_LIMIT';
  end if;

  insert into public.email_broadcasts(created_by, subject, body, status, recipient_count)
  values(p_created_by, btrim(p_subject), btrim(p_body), 'queued', requested_count)
  returning * into campaign;

  insert into public.email_broadcast_recipients(campaign_id, user_id, email)
  select campaign.id, eligible.id, lower(btrim(eligible.email))
  from jsonb_to_recordset(p_recipients) as requested("userId" uuid, email text)
  join public.users eligible on eligible.id = requested."userId"
    and lower(btrim(eligible.email)) = lower(btrim(requested.email))
    and public.operix_email_verification_reminder_domain_allowed(eligible.email)
    and (eligible.role = 'user' or (
      eligible.role = 'admin'
      and lower(split_part(btrim(eligible.email), '@', 2)) = 'operix.website'
    ))
    and eligible.is_banned = false
    and eligible.email_verified = true
    and eligible.email_updates_opt_out = false;

  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then
    raise exception using errcode = 'P0001', message = 'EMAIL_BROADCAST_AUDIENCE_CHANGED';
  end if;

  insert into public.audit_logs(actor_id, action, entity, metadata, created_at)
  values(
    p_created_by,
    'email_broadcast_queued',
    campaign.id::text,
    jsonb_build_object('subject', btrim(p_subject), 'recipientCount', inserted_count),
    now()
  );

  return jsonb_build_object('id', campaign.id, 'recipientCount', inserted_count, 'status', campaign.status);
end;
$$;

create or replace function public.operix_claim_email_broadcast_recipients(
  p_campaign_id uuid,
  p_batch_size integer default 100
) returns setof public.email_broadcast_recipients
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_batch_size < 1 or p_batch_size > 100 then
    raise exception using errcode = 'P0001', message = 'EMAIL_BROADCAST_BATCH_SIZE_INVALID';
  end if;

  update public.email_broadcast_recipients recipient
  set status = 'suppressed', last_error = 'RECIPIENT_NO_LONGER_ELIGIBLE', updated_at = now()
  where recipient.campaign_id = p_campaign_id
    and recipient.status = 'queued'
    and not exists (
      select 1 from public.users eligible
      where eligible.id = recipient.user_id
        and lower(btrim(eligible.email)) = recipient.email
        and public.operix_email_verification_reminder_domain_allowed(eligible.email)
        and (eligible.role = 'user' or (
          eligible.role = 'admin'
          and lower(split_part(btrim(eligible.email), '@', 2)) = 'operix.website'
        ))
        and eligible.is_banned = false
        and eligible.email_verified = true
        and eligible.email_updates_opt_out = false
    );

  return query
  with claimable as (
    select recipient.id
    from public.email_broadcast_recipients recipient
    where recipient.campaign_id = p_campaign_id
      and recipient.status = 'queued'
      and exists (
        select 1 from public.users eligible
        where eligible.id = recipient.user_id
          and lower(btrim(eligible.email)) = recipient.email
          and public.operix_email_verification_reminder_domain_allowed(eligible.email)
          and (eligible.role = 'user' or (
            eligible.role = 'admin'
            and lower(split_part(btrim(eligible.email), '@', 2)) = 'operix.website'
          ))
          and eligible.is_banned = false
          and eligible.email_verified = true
          and eligible.email_updates_opt_out = false
      )
    order by recipient.created_at, recipient.id
    for update skip locked
    limit p_batch_size
  )
  update public.email_broadcast_recipients recipient
  set status = 'sending', attempts = attempts + 1, updated_at = now()
  from claimable
  where recipient.id = claimable.id
  returning recipient.*;
end;
$$;

revoke all on function public.operix_create_email_broadcast_atomic(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.operix_claim_email_broadcast_recipients(uuid, integer) from public, anon, authenticated;
grant execute on function public.operix_create_email_broadcast_atomic(text, text, uuid, jsonb) to service_role;
grant execute on function public.operix_claim_email_broadcast_recipients(uuid, integer) to service_role;

commit;