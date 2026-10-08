-- Daily task data cleanup for stale/ghost task locks
-- Run this in Supabase SQL Editor when the live board still shows old task locks.
-- This keeps today’s task tables aligned with the active plan and clears invalid rows.

BEGIN;

-- Remove orphaned completion rows with no valid task key and task day mismatch.
DELETE FROM public.daily_task_completions
WHERE task_key IS NULL
   OR task_key = ''
   OR task_date IS NULL;

-- Remove orphaned submissions with empty task keys or missing assignment reference.
DELETE FROM public.daily_task_submissions
WHERE task_key IS NULL
   OR task_key = ''
   OR task_date IS NULL;

-- Remove orphaned assignments with no valid task number or tier.
DELETE FROM public.daily_task_assignments
WHERE task_number IS NULL
   OR task_number < 1
   OR tier_code IS NULL
   OR tier_code = ''
   OR task_date IS NULL;

-- Remove stale future starts that were left behind by earlier task generation bugs.
UPDATE public.daily_task_assignments
SET created_at = NOW()
WHERE created_at > NOW();

-- Remove ghost rows for task numbers that are out of range for the current active daily plan.
DELETE FROM public.daily_task_assignments
WHERE task_number > 12;

DELETE FROM public.daily_task_completions
WHERE task_key !~ '^[A-Z0-9]+-task-[0-9]{2}$';

DELETE FROM public.daily_task_submissions
WHERE task_key !~ '^[A-Z0-9]+-task-[0-9]{2}$';

-- Optional: clear stale rows for a specific user/date when needed.
-- DELETE FROM public.daily_task_completions WHERE user_id = 'USER_ID' AND task_date = CURRENT_DATE;
-- DELETE FROM public.daily_task_submissions WHERE user_id = 'USER_ID' AND task_date = CURRENT_DATE;
-- DELETE FROM public.daily_task_assignments WHERE user_id = 'USER_ID' AND task_date = CURRENT_DATE;

COMMIT;

-- Safety check: these rows should no longer exist for the active day.
SELECT 'daily task cleanup complete' AS status;
