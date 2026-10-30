-- Enable withdrawal requests every day for every tier and notify all existing users.
-- Apply once to the production Supabase database before deploying this application version.
begin;

drop trigger if exists withdrawal_tier_day_guard on public.transactions;
drop function if exists public.operix_guard_tier_withdrawal_day();

insert into public.notifications (user_id, title, body, type)
select
  u.id,
  'تحديث مهم: السحب متاح يوميًا',
  'أصبح تقديم طلبات السحب متاحًا يوميًا لجميع المستويات، طوال أيام الأسبوع. تستمر شروط السحب الأخرى كما هي، بما في ذلك توثيق البريد، وتثبيت محفظة TRC20، والحد الأدنى والرسوم وحدود الحساب ومراجعة الطلب.',
  'system'
from public.users u
where not exists (
  select 1
  from public.notifications n
  where n.user_id = u.id
    and n.title = 'تحديث مهم: السحب متاح يوميًا'
    and n.body = 'أصبح تقديم طلبات السحب متاحًا يوميًا لجميع المستويات، طوال أيام الأسبوع. تستمر شروط السحب الأخرى كما هي، بما في ذلك توثيق البريد، وتثبيت محفظة TRC20، والحد الأدنى والرسوم وحدود الحساب ومراجعة الطلب.'
);

commit;
