begin;

-- Convert awards created under the original 2/3/5 schedule to the updated 1/2/4 schedule.
-- Safe to rerun: rows are adjusted only when their stored values match the old schedule.
with point_deltas as (
  select
    referrer_id,
    sum(case level_number when 1 then 1 - 2 when 2 then 2 - 3 when 3 then 4 - 5 else 0 end)::integer as delta
  from public.campaign_point_awards
  where (level_number = 1 and points = 2)
     or (level_number = 2 and points = 3)
     or (level_number = 3 and points = 5)
  group by referrer_id
)
update public.users as users
set campaign_points = users.campaign_points + point_deltas.delta,
    updated_at = now()
from point_deltas
where users.id = point_deltas.referrer_id;

update public.campaign_point_awards
set points = case level_number when 1 then 1 when 2 then 2 when 3 then 4 else points end
where (level_number = 1 and points = 2)
   or (level_number = 2 and points = 3)
   or (level_number = 3 and points = 5);

commit;
