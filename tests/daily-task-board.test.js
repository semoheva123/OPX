const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const activityController = require('../src/controllers/activityController');
const automation = require('../src/services/dailyTaskAutomation');
const weeklySchedule = require('../src/services/weeklySchedule');
const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase/schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/automated-daily-tasks.sql'), 'utf8');
const ratingCooldownMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase/daily-task-rating-cooldown.sql'), 'utf8');
const adminController = fs.readFileSync(path.join(__dirname, '..', 'src/controllers/adminController.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.equal(weeklySchedule.isTaskHoliday(new Date('2026-10-09T12:00:00.000Z')), true, 'Friday must remain a task holiday');
assert.equal(weeklySchedule.isTaskHoliday(new Date('2026-10-10T12:00:00.000Z')), true, 'Saturday must remain a task holiday');
assert.equal(weeklySchedule.getWithdrawalSchedule('A1', new Date('2026-10-09T12:00:00.000Z')).allowed, true, 'A1 withdrawals are scheduled Friday');
assert.equal(weeklySchedule.getWithdrawalSchedule('A2', new Date('2026-10-09T12:00:00.000Z')).allowed, true, 'A2 withdrawals are scheduled Friday');
assert.equal(weeklySchedule.getWithdrawalSchedule('A3', new Date('2026-10-10T12:00:00.000Z')).allowed, true, 'remaining tiers withdraw Saturday');

const assignments = [
	{ entityKey: 'wiki:example-systems', entityName: 'Example Systems', category: 'technology', summary: 'شركة تقنية للاختبار.', imageUrl: '', submissionComplete: false },
	{ entityKey: 'wiki:example-ai', entityName: 'Example AI', category: 'ai', summary: 'منصة ذكاء للاختبار.', imageUrl: 'https://images.example.test/ai.png', submissionComplete: false }
];
const tasks = activityController.buildDailyTasks('A1', assignments, new Set(), false, 1.5, { communityEngagement: true });

assert.equal(Array.isArray(tasks), true, 'يجب أن تُعيد قائمة مهام');
assert.equal(tasks.length, 3, 'يجب أن تضم الخطة المهمة المجتمعية والتقييمات المخصصة فقط');
assert.equal(typeof tasks[0].title, 'string', 'يجب أن تحتوي المهمة على عنوان');
assert.equal(typeof tasks[0].instructions, 'object', 'يجب أن تحتوي المهمة على إرشادات');
assert.equal(tasks[0].instructions.length > 0, true, 'يجب أن تحتوي المهمة على تعليمات');
assert.equal(typeof tasks[0].reward, 'number', 'يجب أن تحتوي المهمة على قيمة مكافأة');
assert.equal(tasks[0].taskKey, 'A1-community');
assert.equal(tasks[0].requirement, 'community_engagement');
assert.equal(tasks[0].requirementMet, true, 'المهمة الثابتة واحدة وتجمع النشر والتفاعل');
assert.equal(tasks[1].taskKey, 'A1-task-02');
assert.equal(tasks[1].requirement, 'evaluation');
assert.equal(tasks[1].targetName, 'Example Systems');
assert.equal(tasks[1].targetSummary, 'شركة تقنية للاختبار.');
assert.ok(tasks[1].tags.includes('الخصوصية'));
assert.equal(tasks[2].targetCategory, 'ai');
assert.equal(tasks[2].targetImageUrl, 'https://images.example.test/ai.png');
const now = Date.parse('2031-06-01T12:00:00.000Z');
assert.deepEqual(activityController.getDailyTaskProgress('A1', 3, [], now), {
	nextTaskNumber: 1,
	availableAt: new Date(now).toISOString(),
	remainingMs: 0,
	remainingSeconds: 0
});
const afterCommunity = [{ taskKey: 'A1-community', createdAt: new Date(now - 5 * 60 * 1000).toISOString() }];
const cooldown = activityController.getDailyTaskProgress('A1', 3, afterCommunity, now);
assert.equal(cooldown.nextTaskNumber, 2);
assert.equal(cooldown.remainingMs, 2 * 60 * 60 * 1000 + 55 * 60 * 1000, 'the next task unlocks 3 hours after its predecessor');
assert.equal(activityController.getDailyTaskProgress('A1', 3, afterCommunity, now + 3 * 60 * 60 * 1000).remainingMs, 0, 'the task unlocks exactly at the 3-hour boundary');
const afterSecond = [...afterCommunity, { taskKey: 'A1-task-02', createdAt: new Date(now - 2 * 60 * 1000).toISOString() }];
assert.equal(activityController.getDailyTaskProgress('A1', 3, afterSecond, now).nextTaskNumber, 3);
assert.equal(activityController.getDailyTaskProgress('A1', 3, [{ taskKey: 'A1-task-02', createdAt: new Date(now).toISOString() }], now).nextTaskNumber, 1, 'a later task cannot advance the sequence without its predecessor');
assert.equal(activityController.getDailyTaskProgress('A1', 2, [...afterCommunity, { taskKey: 'A1-task-02' }], now).nextTaskNumber, null);
const stripeTask = activityController.buildDailyTasks('A1', [
	{ entityKey: 'finance:stripe', entityName: 'Stripe, Inc.', category: 'finance', summary: 'خدمة مالية.', imageUrl: '', submissionComplete: false }
], new Set(), false, 1)[1];
assert.equal(stripeTask.targetImageUrl, 'https://www.google.com/s2/favicons?domain=stripe.com&sz=128', 'known brands should use the favicon hosted by their official domain when task data has no image');
assert.equal(automation.getOfficialBrandLogoUrl('Intel'), 'https://www.google.com/s2/favicons?domain=intel.com&sz=128');
assert.equal(automation.getOfficialBrandLogoUrl('MetaTrader'), 'https://www.metatrader5.com/i/metatrader-5-logo.png');
assert.ok(tasks.every(task => task.reward > 0));
assert.ok(Math.abs(tasks.reduce((sum, task) => sum + task.reward, 0) - 1.5) < 0.0001, 'المكافآت اليومية يجب أن تتجمع إلى الحد الثابت دون تجاوز');
assert.notEqual(tasks[1].reward, tasks[2].reward, 'قيمة كل مهمة يجب أن تختلف حسب الشركة أو الفئة');
assert.deepEqual(automation.getEvaluationTags('crypto'), ['الأمان', 'الشفافية', 'المنفعة', 'اللامركزية', 'التقلب', 'الرسوم', 'الحوكمة']);

const dayStart = new Date('2026-10-03T00:00:00.000Z');
assert.equal(activityController.hasDailyPlatformPost([
	{ authorId: 'user-1', status: 'visible', content: 'Hello OPERIX community', createdAt: '2026-10-03T10:00:00.000Z' }
], 'user-1', dayStart), true, 'منشور اليوم الذي يذكر OPERIX يستوفي المهمة');
assert.equal(activityController.hasDailyPlatformPost([
	{ authorId: 'user-1', status: 'visible', content: 'Hello OPERIX community', createdAt: '2026-10-02T23:59:59.000Z' }
], 'user-1', dayStart), false, 'المنشور القديم لا يستوفي المهمة اليومية');
assert.equal(activityController.hasDailyCommunityInteraction([
	{ authorId: 'author-2', status: 'visible', comments: [{ authorId: 'user-1', status: 'visible', createdAt: '2026-10-03T10:00:00.000Z' }] }
], 'user-1', dayStart), true, 'تعليق اليوم على منشور مستخدم آخر يستوفي التفاعل');
assert.equal(activityController.hasDailyCommunityInteraction([
	{ authorId: 'author-2', status: 'visible', comments: [{ authorId: 'user-1', status: 'visible', createdAt: '2026-10-03T10:00:00.000Z' }] }
], 'user-1', dayStart), true, 'التعليق الظاهر اليوم على منشور مستخدم آخر يستوفي التفاعل');
assert.equal(activityController.hasDailyCommunityInteraction([
	{ authorId: 'user-1', status: 'visible', likedBy: ['user-1'], comments: [{ authorId: 'user-1', status: 'visible', createdAt: '2026-10-03T10:00:00.000Z' }] }
], 'user-1', dayStart), false, 'التفاعل مع المنشور الشخصي لا يستوفي المهمة');
assert.match(schema, /COMMUNITY_TASK_REQUIRED/);
assert.match(schema, /EVALUATION_REQUIRED/);
assert.doesNotMatch(schema, /length\(trim\(submission\.feedback\)\) between 10 and 500/i, 'notes must not be a completion requirement');
assert.match(schema, /operix_enforce_daily_task_sequence_and_cooldown/i);
assert.match(migration, /operix_enforce_daily_task_sequence_and_cooldown/i);
assert.match(ratingCooldownMigration, /TASK_COOLDOWN_ACTIVE/i);
assert.match(ratingCooldownMigration, /interval '3 hours'/i);
assert.doesNotMatch(ratingCooldownMigration, /length\(trim\(submission\.feedback\)\) between 10 and 500/i);
assert.match(ratingCooldownMigration, /total_daily_reward \+ gross_reward > coalesce\(level_row\.daily_profit, 0\)/i, 'the replacement task RPC must preserve the fixed daily reward cap');
assert.match(ratingCooldownMigration, /DAILY_CAP_REACHED/i, 'the database must reject task rewards that exceed the daily cap');
assert.match(schema, /daily_task_submissions/);
assert.match(schema, /daily_task_assignments/);
assert.match(schema, /daily_task_entities/);
assert.match(schema, /enable row level security/i);
assert.match(schema, /grant execute on function public\.operix_daily_task_complete_atomic\(uuid, text\) to service_role/i);
assert.match(migration, /create or replace function public\.operix_daily_task_complete_atomic/i);
assert.match(migration, /COMMUNITY_TASK_REQUIRED/);
assert.match(migration, /EVALUATION_REQUIRED/);
assert.match(adminController, /evaluationCount \+ 1/, 'task count must follow the fixed community task plus the admin-controlled evaluation count');
assert.match(client, /button\.disabled = !currentUserTierActive/, 'the daily task card must remain an entry to the plan after all tasks are marked complete');
assert.match(client, /id: 'daily',[^\n]*done: false/, 'stale completion counters must not remove the daily-plan entry');
assert.match(client, /data\.taskLimit \?\? data\.tier\?\.taskLimit/, 'the task detail panel must read the total from the API tier payload');
assert.match(client, /filter\(task => !task\.completed\)/, 'completed tasks must be filtered out before rendering the premium task list');
assert.match(client, /targetImageUrl.*alt.*targetName|brand.*task\.targetName/, 'the paid-task panel must show the evaluation brand logo and company name in a premium card');
assert.match(client, /style="width:96px;height:48px".*object-fit:contain/, 'the company logo should use a fixed landscape tile and preserve the source aspect ratio');
assert.doesNotMatch(client, /ملاحظة قصيرة|data-evaluation-field="feedback"/, 'the task evaluation form must not ask for a short note');
assert.match(client, /data-task-cooldown/, 'the only next task should show a cooldown countdown when locked');

console.log('daily-task-board test: OK');
