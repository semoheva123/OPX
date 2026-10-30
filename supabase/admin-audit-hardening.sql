-- OPERIX · Admin audit hardening and server-side pagination
-- Safe to re-run. Applies to PostgreSQL / Supabase only.
--
-- What it does:
--   1. Adds ip / user_agent columns to audit_logs so every admin action records its origin.
--   2. Adds the indexes required for filtered, paginated audit reads.
--   3. Installs public.admin_audit_logs_page(...) — a service-role-only RPC that filters,
--      counts and pages audit entries inside PostgreSQL instead of loading 10k rows into Node.
--
-- Deployment order: run after schema.sql (or on an existing production database) and before
-- deploying the admin console release that calls this RPC. The application falls back to the
-- previous in-memory behaviour when the RPC is missing, so the rollout is backwards compatible.

begin;

alter table public.audit_logs add column if not exists ip text;
alter table public.audit_logs add column if not exists user_agent text;

create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_action_created_at on public.audit_logs (action, created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity);

create or replace function public.admin_audit_logs_page(
  p_action text default null,
  p_search text default null,
  p_date date default null,
  p_limit int default 20,
  p_offset int default 0
) returns jsonb
language sql
security definer
set search_path = public
as $$
  with filtered as (
    select a.id,
           a.actor_id,
           a.action,
           a.entity,
           a.metadata,
           a.ip,
           a.user_agent,
           a.created_at
      from public.audit_logs a
     where (coalesce(p_action, '') = '' or p_action = 'all' or a.action = p_action)
       and (p_date is null or a.created_at::date = p_date)
       and (
         coalesce(p_search, '') = ''
         or a.action ilike '%' || p_search || '%'
         or coalesce(a.entity, '') ilike '%' || p_search || '%'
       )
  ),
  page_rows as (
    select * from filtered
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 5000))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'logs', coalesce((select jsonb_agg(to_jsonb(page_rows) order by page_rows.created_at desc) from page_rows), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_audit_logs_page(text, text, date, int, int) from public;
revoke all on function public.admin_audit_logs_page(text, text, date, int, int) from anon;
revoke all on function public.admin_audit_logs_page(text, text, date, int, int) from authenticated;
grant execute on function public.admin_audit_logs_page(text, text, date, int, int) to service_role;

commit;
