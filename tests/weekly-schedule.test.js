const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedule = require('../src/services/weeklySchedule');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const activityController = read('src/controllers/activityController.js');
const walletController = read('src/controllers/walletController.js');
const client = read('app.js');
const index = read('index.html');
const migration = read('supabase/weekly-schedule-guards.sql');
const readiness = read('supabase/production-readiness.sql');

const friday = new Date('2026-10-09T12:00:00.000Z');
const saturday = new Date('2026-10-10T12:00:00.000Z');
const sunday = new Date('2026-10-11T12:00:00.000Z');
const thursday = new Date('2026-10-08T12:00:00.000Z');
const fridayLocalBoundary = new Date('2026-10-08T21:00:00.000Z');
const saturdayLocalBoundary = new Date('2026-10-09T21:00:00.000Z');

assert.equal(schedule.isTaskHoliday(fridayLocalBoundary), true, 'Friday local midnight must count as a task holiday in Istanbul time');
assert.equal(schedule.getWithdrawalSchedule('A1', fridayLocalBoundary).allowed, true, 'A1 local Friday must allow withdrawal requests at Istanbul midnight');
assert.equal(schedule.getWithdrawalSchedule('A1', saturdayLocalBoundary).allowed, false, 'A1 must not allow withdrawals on Saturday in Istanbul time');
assert.equal(schedule.isTaskHoliday(friday), true, 'Friday is a task holiday');
assert.equal(schedule.isTaskHoliday(saturday), true, 'Saturday is a task holiday');
assert.equal(schedule.isTaskHoliday(sunday), false, 'Sunday is a task day');
assert.equal(schedule.isTaskHoliday(thursday), false, 'Thursday is a task day');
assert.equal(schedule.getTaskSchedule(friday).message, 'عطلة المهام الأسبوعية: لا توجد مهام يوم الجمعة.');

for (const tier of ['A1', 'A2']) {
  assert.equal(schedule.getWithdrawalSchedule(tier, friday).allowed, true, `${tier} can request withdrawals on Friday`);
  assert.equal(schedule.getWithdrawalSchedule(tier, saturday).allowed, false, `${tier} cannot request withdrawals on Saturday`);
  assert.equal(schedule.getWithdrawalSchedule(tier, sunday).nextAvailableAt, '2026-10-15T21:00:00.000Z');
}
for (const tier of ['A3', 'A4', 'A5', 'UNKNOWN']) {
  assert.equal(schedule.getWithdrawalSchedule(tier, friday).allowed, false, `${tier} cannot request withdrawals on Friday`);
  assert.equal(schedule.getWithdrawalSchedule(tier, saturday).allowed, true, `${tier} can request withdrawals on Saturday`);
  assert.equal(schedule.getWithdrawalSchedule(tier, sunday).nextAvailableAt, '2026-10-16T21:00:00.000Z');
}
assert.equal(schedule.getWithdrawalSchedule('A1', thursday).nextAvailableAt, '2026-10-08T21:00:00.000Z');

assert.match(activityController, /getTaskSchedule\(new Date\(\)\)/, 'task listing and completion must consult the weekly schedule');
assert.match(activityController, /holiday: true[\s\S]*?tasks: \[\]/, 'holiday task API response must provide no tasks');
assert.match(activityController, /code: 'TASK_HOLIDAY'/, 'task completion must fail closed on a holiday');
assert.match(walletController, /getWithdrawalSchedule\(user\.tierCode, new Date\(\)\)/, 'withdrawal request must enforce tier weekday on the server');
assert.match(walletController, /code: 'WITHDRAWAL_DAY_NOT_ALLOWED'/, 'withdrawal schedule rejection must be explicit');
assert.match(client, /يوم الجمعة أو السبت/);
assert.match(index, /withdrawalScheduleStatus/);
for (const source of [migration, readiness]) {
  assert.match(source, /daily_task_weekend_holiday_guard/i, 'database must block weekend task completion');
  assert.match(source, /withdrawal_tier_day_guard/i, 'database must enforce the withdrawal schedule');
  assert.match(source, /WITHDRAWAL_DAY_NOT_ALLOWED/i);
  assert.match(source, /TASK_HOLIDAY/i);
}
assert.doesNotMatch(migration, /withdrawal_payouts[\s\S]*?before insert/i, 'the new request schedule must not block settlement of already accepted payouts');

console.log('Weekly task and withdrawal schedule tests: ok');
