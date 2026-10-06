-- Enforce the same consumer-provider allowlist as the reminder worker.
-- Safe to re-run; suppresses queued disallowed recipients without touching history.
begin;

create or replace function public.operix_email_verification_reminder_domain_allowed(p_email text)
returns boolean
language sql
immutable
strict
as $$
  select split_part(lower(btrim(p_email)), '@', 2) = any (array[
    'operix.website',
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

create or replace function public.operix_guard_email_verification_reminder_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.operix_email_verification_reminder_domain_allowed(new.email) then
    raise exception using errcode = '23514', message = 'RECIPIENT_DOMAIN_NOT_ALLOWED';
  end if;
  return new;
end;
$$;

drop trigger if exists email_verification_reminder_domain_guard on public.email_verification_reminder_recipients;
create trigger email_verification_reminder_domain_guard
  before insert or update of email on public.email_verification_reminder_recipients
  for each row execute function public.operix_guard_email_verification_reminder_domain();

create or replace function public.operix_guard_email_broadcast_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.operix_email_verification_reminder_domain_allowed(new.email) then
    raise exception using errcode = '23514', message = 'RECIPIENT_DOMAIN_NOT_ALLOWED';
  end if;
  return new;
end;
$$;

drop trigger if exists email_broadcast_recipient_domain_guard on public.email_broadcast_recipients;
create trigger email_broadcast_recipient_domain_guard
  before insert or update of email on public.email_broadcast_recipients
  for each row execute function public.operix_guard_email_broadcast_domain();

revoke all on function public.operix_email_verification_reminder_domain_allowed(text) from public, anon, authenticated;
revoke all on function public.operix_guard_email_verification_reminder_domain() from public, anon, authenticated;
revoke all on function public.operix_guard_email_broadcast_domain() from public, anon, authenticated;
grant execute on function public.operix_email_verification_reminder_domain_allowed(text) to service_role;
grant execute on function public.operix_guard_email_verification_reminder_domain() to service_role;
grant execute on function public.operix_guard_email_broadcast_domain() to service_role;

update public.email_verification_reminder_recipients
set status = 'suppressed', last_error = 'RECIPIENT_DOMAIN_NOT_ALLOWED', updated_at = now()
where status = 'queued'
  and not public.operix_email_verification_reminder_domain_allowed(email);

update public.email_broadcast_recipients
set status = 'suppressed', last_error = 'RECIPIENT_DOMAIN_NOT_ALLOWED', updated_at = now()
where status = 'queued'
  and not public.operix_email_verification_reminder_domain_allowed(email);

commit;