const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedule = require('../src/services/weeklySchedule');
const { getTaskPeriodStarts } = require('../src/services/taskCalendar');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const activityController = read('src/controllers/activityController.js');
const walletController = read('src/controllers/walletController.js');
const client = read('app.js');
const index = read('index.html');
const migration = read('supabase/weekly-schedule-guards.sql');
const readiness = read('supabase/production-readiness.sql');
const allDaysMigration = read('supabase/withdrawals-all-weekdays.sql');

const friday = new Date('2026-10-09T12:00:00.000Z');
const saturday = new Date('2026-10-10T12:00:00.000Z');
const sunday = new Date('2026-10-11T12:00:00.000Z');
const thursday = new Date('2026-10-08T12:00:00.000Z');
const fridayLocalBoundary = new Date('2026-10-08T21:00:00.000Z');
const newIstanbulDay = getTaskPeriodStarts(new Date('2026-10-18T21:30:00.000Z'));
assert.equal(newIstanbulDay.todayStart.toISOString(), '2026-10-18T21:00:00.000Z', 'daily limits should reset at Istanbul midnight');
assert.equal(newIstanbulDay.weekStart.toISOString(), '2026-10-12T21:00:00.000Z', 'seven-day limits should use the same Istanbul calendar');

assert.equal(schedule.isTaskHoliday(fridayLocalBoundary), true, 'Friday local midnight must count as the only task holiday in Istanbul time');
assert.equal(schedule.isTaskHoliday(friday), true, 'Friday is the only task holiday');
assert.equal(schedule.isTaskHoliday(saturday), false, 'Saturday is not a task holiday');
assert.equal(schedule.isTaskHoliday(sunday), false, 'Sunday is a task day');
assert.equal(schedule.isTaskHoliday(thursday), false, 'Thursday is a task day');
assert.equal(schedule.getTaskSchedule(friday).message, 'عطلة المهام الأسبوعية: لا توجد مهام يوم الجمعة.');
assert.equal(schedule.getTaskSchedule(saturday).holiday, false, 'Saturday tasks should stay available');

for (const tier of ['A1', 'A2', 'A3', 'A4', 'A5', 'UNKNOWN']) {
  for (const date of [thursday, friday, saturday, sunday]) {
    const withdrawalSchedule = schedule.getWithdrawalSchedule(tier, date);
    assert.equal(withdrawalSchedule.allowed, true, `${tier} can request withdrawals every day`);
    assert.equal(withdrawalSchedule.allowedDayName, 'كل أيام الأسبوع');
    assert.equal(withdrawalSchedule.nextAvailableAt, null);
    assert.match(withdrawalSchedule.message, /يوميًا/);
  }
}

assert.match(activityController, /getTaskSchedule\(new Date\(\)\)/, 'task listing and completion must consult the weekly schedule');
assert.match(activityController, /holiday: true[\s\S]*?tasks: \[\]/, 'holiday task API response must provide no tasks on Friday only');
assert.match(activityController, /TASK_HOLIDAY/, 'task completion can still reject Friday as the scheduled holiday');
assert.doesNotMatch(walletController, /if \(!withdrawalSchedule\.allowed\)/, 'server withdrawal request must not retain the tier weekday block');
assert.doesNotMatch(walletController, /status\(403\).*WITHDRAWAL_DAY_NOT_ALLOWED/, 'server must not reject a withdrawal based on its weekday');
assert.match(walletController, /WITHDRAWAL_SCHEDULE_UPDATE_REQUIRED/, 'a legacy database trigger should produce an actionable update-required response');
assert.match(client, /يوم الجمعة/);
assert.match(client, /return day === 5;/, 'the client should treat Friday as the only task holiday');
assert.doesNotMatch(client, /return day === 5 \|\| day === 6;/, 'Saturday must remain available for tasks in the client');
assert.match(client, /السحب متاح يوميًا لمستوى/);
assert.match(index, /withdrawalScheduleStatus/);
for (const source of [migration, readiness, allDaysMigration]) {
  assert.match(source, /drop trigger if exists withdrawal_tier_day_guard/i, 'database migrations must remove the legacy withdrawal weekday guard');
  assert.doesNotMatch(source, /create trigger withdrawal_tier_day_guard/i, 'database migrations must not recreate the withdrawal weekday guard');
}
for (const source of [migration, readiness]) {
  assert.match(source, /daily_task_weekend_holiday_guard/i, 'database should only guard Friday as the task holiday');
  assert.match(source, /TASK_HOLIDAY/i);
}
assert.match(allDaysMigration, /insert into public\.notifications/i, 'migration creates an internal notification');
assert.match(allDaysMigration, /from public\.users u/i, 'the notification is addressed to every existing user');
assert.match(allDaysMigration, /where not exists/i, 'rerunning the migration does not duplicate the notification');
assert.doesNotMatch(migration, /withdrawal_payouts[\s\S]*?before insert/i, 'schedule changes must not block settlement of already accepted payouts');

console.log('Weekly task and all-days withdrawal schedule tests: ok');
