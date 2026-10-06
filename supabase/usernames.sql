-- Add stable, case-insensitive unique usernames while keeping UUID as the account key.
-- Existing accounts receive a deterministic unique handle; users can choose a shorter handle afterward.
begin;

alter table public.users add column if not exists username text;

update public.users
set username = lower(trim(email))
where username is null or btrim(username) = '';

update public.users set username = lower(trim(username)) where username <> lower(trim(username));

alter table public.users drop constraint if exists users_username_format_check;
alter table public.users add constraint users_username_format_check
  check (username ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create unique index if not exists users_username_lower_unique_idx
  on public.users (lower(username));

alter table public.users alter column username set not null;

commit;
