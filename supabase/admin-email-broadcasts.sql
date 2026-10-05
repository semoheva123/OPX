-- Durable admin email announcements with recipient opt-out and bounded queue claims.
-- Apply after schema.sql to the existing Supabase project before deploying the app.
begin;

alter table public.users
  add column if not exists email_updates_opt_out boolean not null default false;

create table if not exists public.email_broadcasts (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.users(id) on delete restrict,
  subject text not null check (char_length(subject) between 1 and 150),
  body text not null check (char_length(body) between 1 and 5000),
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

create table if not exists public.email_broadcast_recipients (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.email_broadcasts(id) on delete cascade,
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

create index if not exists email_broadcasts_status_created_idx
  on public.email_broadcasts(status, created_at);
create index if not exists email_broadcast_recipients_queue_idx
  on public.email_broadcast_recipients(campaign_id, status, created_at);

alter table public.email_broadcasts enable row level security;
alter table public.email_broadcast_recipients enable row level security;
revoke all privileges on table public.email_broadcasts from public, anon, authenticated;
revoke all privileges on table public.email_broadcast_recipients from public, anon, authenticated;
grant all privileges on table public.email_broadcasts to service_role;
grant all privileges on table public.email_broadcast_recipients to service_role;

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
  actor users%rowtype;
  campaign email_broadcasts%rowtype;
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
    and eligible.role = 'user'
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
        and eligible.role = 'user'
        and eligible.is_banned = false
        and eligible.email_verified = true
        and eligible.email_updates_opt_out = false
    );
  return query
  with claimable as (
    select recipient.id
    from public.email_broadcast_recipients recipient
    where recipient.campaign_id = p_campaign_id and recipient.status = 'queued'
      and exists (
        select 1 from public.users eligible
        where eligible.id = recipient.user_id
          and lower(btrim(eligible.email)) = recipient.email
          and eligible.role = 'user'
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
