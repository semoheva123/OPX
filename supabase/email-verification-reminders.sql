-- Durable transactional reminders for eligible accounts with an unverified email.
-- Apply after schema.sql and admin-email-broadcasts.sql.
begin;

alter table public.users
  add column if not exists email_verification_reminder_sent_at timestamptz;

create table if not exists public.email_verification_reminder_campaigns (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.users(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','sending','sent','partial','manual_review')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  unknown_count integer not null default 0 check (unknown_count >= 0),
  last_error text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.email_verification_reminder_recipients (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.email_verification_reminder_campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  email text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','unknown','suppressed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(campaign_id, user_id),
  unique(campaign_id, email)
);

create index if not exists email_verification_reminder_campaign_queue_idx
  on public.email_verification_reminder_campaigns(status, created_at);
create index if not exists email_verification_reminder_recipient_queue_idx
  on public.email_verification_reminder_recipients(campaign_id, status, created_at);

create or replace function public.operix_email_verification_reminder_domain_allowed(p_email text)
returns boolean
language sql
immutable
strict
as $$
  select split_part(lower(btrim(p_email)), '@', 2) = any (array[
    'gmail.com', 'googlemail.com',
    'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.it', 'hotmail.ca', 'hotmail.com.au', 'hotmail.com.tr',
    'live.com', 'live.co.uk', 'live.fr', 'live.de', 'msn.com',
    'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.ca', 'yahoo.com.au', 'yahoo.co.jp', 'yahoo.co.in', 'ymail.com', 'rocketmail.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com',
    'proton.me', 'protonmail.com', 'pm.me', 'tuta.com', 'tuta.io', 'tutanota.com',
    'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'zoho.com', 'zohomail.com',
    'fastmail.com', 'fastmail.fm', 'hey.com',
    'yandex.com', 'yandex.ru', 'yandex.kz', 'yandex.uz',
    'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'rambler.ru',
    'qq.com', '163.com', '126.com', 'yeah.net', 'naver.com', 'daum.net', 'hanmail.net', 'rediffmail.com',
    'orange.fr', 'laposte.net', 'free.fr', 'seznam.cz', 'email.cz', 'wp.pl', 'onet.pl', 'interia.pl', 'o2.pl', 't-online.de', 'freenet.de', 'btinternet.com', 'virginmedia.com'
  ]::text[]);
$$;

alter table public.email_verification_reminder_campaigns enable row level security;
alter table public.email_verification_reminder_recipients enable row level security;
revoke all privileges on table public.email_verification_reminder_campaigns from public, anon, authenticated;
revoke all privileges on table public.email_verification_reminder_recipients from public, anon, authenticated;
grant all privileges on table public.email_verification_reminder_campaigns to service_role;
grant all privileges on table public.email_verification_reminder_recipients to service_role;

create or replace function public.operix_create_email_verification_reminder_atomic(
  p_created_by uuid,
  p_recipients jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.users%rowtype;
  campaign public.email_verification_reminder_campaigns%rowtype;
  requested_count integer;
  inserted_count integer;
begin
  select * into actor from public.users where id = p_created_by and is_banned = false;
  if actor.id is null or actor.role <> 'admin' then
    raise exception using errcode = '42501', message = 'BROADCAST_PERMISSION_REQUIRED';
  end if;
  if jsonb_typeof(p_recipients) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_VERIFICATION_REMINDER_RECIPIENTS';
  end if;

  requested_count := jsonb_array_length(p_recipients);
  if requested_count < 1 or requested_count > 10000 then
    raise exception using errcode = 'P0001', message = 'EMAIL_VERIFICATION_REMINDER_RECIPIENT_LIMIT';
  end if;

  insert into public.email_verification_reminder_campaigns(created_by, status, recipient_count)
  values (p_created_by, 'queued', requested_count)
  returning * into campaign;

  insert into public.email_verification_reminder_recipients(campaign_id, user_id, email)
  select campaign.id, eligible.id, lower(btrim(eligible.email))
  from jsonb_to_recordset(p_recipients) as requested("userId" uuid, email text)
  join public.users eligible on eligible.id = requested."userId"
    and lower(btrim(eligible.email)) = lower(btrim(requested.email))
    and lower(btrim(eligible.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and public.operix_email_verification_reminder_domain_allowed(eligible.email)
    and eligible.role = 'user'
    and eligible.is_banned = false
    and eligible.email_verified = false
    and eligible.email_updates_opt_out = false
    and (eligible.email_verification_reminder_sent_at is null
      or eligible.email_verification_reminder_sent_at < now() - interval '7 days');

  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then
    raise exception using errcode = 'P0001', message = 'EMAIL_VERIFICATION_REMINDER_AUDIENCE_CHANGED';
  end if;

  insert into public.audit_logs(actor_id, action, entity, metadata, created_at)
  values (
    p_created_by,
    'email_verification_reminder_queued',
    campaign.id::text,
    jsonb_build_object('recipientCount', inserted_count),
    now()
  );

  return jsonb_build_object('id', campaign.id, 'recipientCount', inserted_count, 'status', campaign.status);
end;
$$;

create or replace function public.operix_claim_email_verification_reminder_recipients(
  p_campaign_id uuid,
  p_batch_size integer default 100
) returns setof public.email_verification_reminder_recipients
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_batch_size < 1 or p_batch_size > 100 then
    raise exception using errcode = 'P0001', message = 'EMAIL_VERIFICATION_REMINDER_BATCH_SIZE_INVALID';
  end if;

  update public.email_verification_reminder_recipients recipient
  set status = 'suppressed', last_error = 'RECIPIENT_DOMAIN_NOT_ALLOWED', updated_at = now()
  where recipient.campaign_id = p_campaign_id
    and recipient.status = 'queued'
    and not public.operix_email_verification_reminder_domain_allowed(recipient.email);

  update public.email_verification_reminder_recipients recipient
  set status = 'suppressed', last_error = 'ACCOUNT_NO_LONGER_ELIGIBLE', updated_at = now()
  where recipient.campaign_id = p_campaign_id
    and recipient.status = 'queued'
    and not exists (
      select 1 from public.users eligible
      where eligible.id = recipient.user_id
        and lower(btrim(eligible.email)) = recipient.email
        and public.operix_email_verification_reminder_domain_allowed(eligible.email)
        and eligible.role = 'user'
        and eligible.is_banned = false
        and eligible.email_verified = false
        and eligible.email_updates_opt_out = false
        and (eligible.email_verification_reminder_sent_at is null
          or eligible.email_verification_reminder_sent_at < now() - interval '7 days')
    );

  return query
  with claimable as (
    select recipient.id
    from public.email_verification_reminder_recipients recipient
    where recipient.campaign_id = p_campaign_id
      and recipient.status = 'queued'
      and exists (
        select 1 from public.users eligible
        where eligible.id = recipient.user_id
          and lower(btrim(eligible.email)) = recipient.email
          and public.operix_email_verification_reminder_domain_allowed(eligible.email)
          and eligible.role = 'user'
          and eligible.is_banned = false
          and eligible.email_verified = false
          and eligible.email_updates_opt_out = false
          and (eligible.email_verification_reminder_sent_at is null
            or eligible.email_verification_reminder_sent_at < now() - interval '7 days')
      )
    order by recipient.created_at, recipient.id
    for update skip locked
    limit p_batch_size
  )
  update public.email_verification_reminder_recipients recipient
  set status = 'sending', attempts = attempts + 1, updated_at = now()
  from claimable
  where recipient.id = claimable.id
  returning recipient.*;
end;
$$;

create or replace function public.operix_prepare_email_verification_reminder_atomic(
  p_user_id uuid,
  p_email text,
  p_token text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_expires_at is null
      or p_expires_at <= now() or p_expires_at > now() + interval '25 hours' then
    raise exception using errcode = 'P0001', message = 'INVALID_VERIFICATION_REMINDER_TOKEN';
  end if;

  update public.users
  set email_verification_token = p_token,
      email_verification_expire = p_expires_at,
      email_verification_reminder_sent_at = now()
  where id = p_user_id
    and lower(btrim(email)) = lower(btrim(p_email))
    and public.operix_email_verification_reminder_domain_allowed(email)
    and role = 'user'
    and is_banned = false
    and email_verified = false
    and email_updates_opt_out = false
    and (email_verification_reminder_sent_at is null
      or email_verification_reminder_sent_at < now() - interval '7 days');

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke all on function public.operix_create_email_verification_reminder_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.operix_claim_email_verification_reminder_recipients(uuid, integer) from public, anon, authenticated;
revoke all on function public.operix_prepare_email_verification_reminder_atomic(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.operix_email_verification_reminder_domain_allowed(text) from public, anon, authenticated;
grant execute on function public.operix_create_email_verification_reminder_atomic(uuid, jsonb) to service_role;
grant execute on function public.operix_claim_email_verification_reminder_recipients(uuid, integer) to service_role;
grant execute on function public.operix_prepare_email_verification_reminder_atomic(uuid, text, text, timestamptz) to service_role;
grant execute on function public.operix_email_verification_reminder_domain_allowed(text) to service_role;

commit;
