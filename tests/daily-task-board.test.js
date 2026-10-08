const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataAccess = require('../src/services/dataAccess');
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
const tasks = activityController.buildDailyTasks('A1', assignments, new Set(), false, 1.5);

assert.equal(Array.isArray(tasks), true, 'يجب أن تُعيد قائمة مهام');
assert.equal(tasks.length, 2, 'يجب أن تضم الخطة مهام تقييم مدفوعة فقط بدون مهمة المجتمع');
assert.equal(typeof tasks[0].title, 'string', 'يجب أن تحتوي المهمة على عنوان');
assert.equal(Array.isArray(tasks[0].instructions), true, 'يجب أن تحتوي المهمة على قائمة إرشادات');
assert.equal(typeof tasks[0].reward, 'number', 'يجب أن تحتوي المهمة على قيمة مكافأة');
assert.equal(tasks[0].taskKey, 'A1-task-01');
assert.equal(tasks[0].number, 1, 'the visible task number must match the actual task key');
assert.equal(tasks[0].requirement, 'evaluation');
assert.equal(tasks[0].targetName, 'Example Systems');
const shiftedTask = activityController.buildDailyTasks('A3', [{ taskNumber: 2, entityName: 'Shifted Systems', category: 'technology', summary: 'مهمة shifted.', imageUrl: '', submissionComplete: false }], new Set(), false, 1)[0];
assert.equal(shiftedTask.taskKey, 'A3-task-02', 'the board must respect the real assignment task number even when it is not the first rendered card');
assert.equal(shiftedTask.number, 2, 'the visible numbering must match the real task key instead of the filtered index');
assert.equal(tasks[0].targetSummary, 'شركة تقنية للاختبار.');
assert.ok(tasks[0].tags.includes('الخصوصية'));
assert.equal(tasks[1].targetCategory, 'ai');
assert.equal(tasks[1].targetImageUrl, 'https://images.example.test/ai.png');
const now = Date.parse('2031-06-01T12:00:00.000Z');
const initialProgress = activityController.getDailyTaskProgress('A1', 3, [], now);
assert.equal(initialProgress.nextTaskNumber, 1, 'the first paid task key is task-01 in the live database plan');
assert.equal(initialProgress.availableAt, new Date(now).toISOString(), 'the first task is available immediately');
assert.equal(initialProgress.remainingMs, 0, 'the first task should never be locked at launch');
assert.equal(initialProgress.remainingSeconds, 0, 'the first task should be instantly ready');
const backlogTasks = [
  { taskKey: 'A1-task-01', createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
  { taskKey: 'A1-task-02', createdAt: new Date(now - 4 * 60 * 60 * 1000).toISOString() },
  { taskKey: 'A1-task-03', createdAt: new Date(now - 6 * 60 * 60 * 1000).toISOString() }
];
const backlog = activityController.getDailyTaskProgress('A1', 4, backlogTasks, now);
assert.deepEqual(backlog.unlockedTaskNumbers, [1, 2, 3, 4], 'the backlog should keep all due paid tasks visible once their actual task numbers unlock');
assert.equal(backlog.nextTaskNumber, 1, 'the first due paid task remains the real task-01 key in the backlog queue');
const stageStartProgress = activityController.getDailyTaskProgress('A3', 6, [{ taskNumber: 1, createdAt: new Date(now).toISOString() }], [], now);
assert.equal(stageStartProgress.taskWindows[1].remainingMs, 2 * 60 * 60 * 1000, 'task-02 should release exactly two hours after the start of the daily plan');
const sixPaidTaskAssignments = Array.from({ length: 6 }, (_, index) => ({
	taskNumber: index + 1,
	createdAt: new Date(now - 12 * 60 * 60 * 1000).toISOString()
}));
const sixPaidTaskProgress = activityController.getDailyTaskProgress('A3', 6, sixPaidTaskAssignments, [], now);
assert.equal(sixPaidTaskProgress.taskWindows.at(-1).taskNumber, 6, 'six paid evaluations map to assignment keys task-01 through task-06');
assert.deepEqual(sixPaidTaskProgress.unlockedTaskNumbers, [1, 2, 3, 4, 5, 6], 'all six paid tasks accumulate after their release windows pass');
const stripeTask = activityController.buildDailyTasks('A1', [
	{ entityKey: 'finance:stripe', entityName: 'Stripe, Inc.', category: 'finance', summary: 'خدمة مالية.', imageUrl: '', submissionComplete: false }
], new Set(), false, 1)[0];
assert.equal(stripeTask.targetImageUrl, 'https://www.google.com/s2/favicons?domain=stripe.com&sz=128', 'known brands should use the favicon hosted by their official domain when task data has no image');
assert.equal(automation.getOfficialBrandLogoUrl('Intel'), 'https://www.google.com/s2/favicons?domain=intel.com&sz=128');
assert.equal(automation.getOfficialBrandLogoUrl('MetaTrader'), 'https://www.metatrader5.com/i/metatrader-5-logo.png');
assert.ok(tasks.every(task => task.reward > 0));
assert.ok(Math.abs(tasks.reduce((sum, task) => sum + task.reward, 0) - 1.5) < 0.0001, 'المكافآت اليومية يجب أن تتجمع إلى الحد الثابت دون تجاوز');
assert.notEqual(tasks[0].reward, tasks[1].reward, 'قيمة كل مهمة يجب أن تختلف حسب الشركة أو الفئة');
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
assert.doesNotMatch(schema, /COMMUNITY_TASK_REQUIRED|OPTIONAL_TASK_NO_REWARD|tier_code \|\| '-community'/i, 'database must not enforce a community task again');
assert.match(schema, /EVALUATION_REQUIRED/);
assert.doesNotMatch(schema, /length\(trim\(submission\.feedback\)\) between 10 and 500/i, 'notes must not be a completion requirement');
assert.match(schema, /operix_enforce_daily_task_sequence_and_cooldown/i);
assert.match(migration, /operix_enforce_daily_task_sequence_and_cooldown/i);
assert.match(ratingCooldownMigration, /TASK_COOLDOWN_ACTIVE/i);
assert.match(ratingCooldownMigration, /interval '2 hours'/i);
assert.doesNotMatch(ratingCooldownMigration, /length\(trim\(submission\.feedback\)\) between 10 and 500/i);
assert.match(ratingCooldownMigration, /requested_task_number > max_tasks/i, 'task keys start at task-01, so the final paid assignment remains within the configured task count');
assert.match(ratingCooldownMigration, /max_tasks := greatest\(coalesce\(level_row\.tasks, 1\), 1\)/i, 'the paid task count must start from the real first paid task without subtracting one');
assert.match(ratingCooldownMigration, /if max_tasks < 1 then raise exception/i, 'the paid reward calculation must never divide by zero');
assert.doesNotMatch(ratingCooldownMigration, /OPTIONAL_TASK_NO_REWARD|tier_code \|\| '-community'/i, 'the database must never keep an optional community task reward path');
assert.match(ratingCooldownMigration, /plan_started_at \+ \(\(task_number - 1\) \* interval '2 hours'\)/i, 'the database release window must accrue from plan start, not the previous completion time');
assert.match(ratingCooldownMigration, /total_daily_reward \+ gross_reward > coalesce\(level_row\.daily_profit, 0\)/i, 'the replacement task RPC must preserve the fixed daily reward cap');
assert.match(ratingCooldownMigration, /DAILY_CAP_REACHED/i, 'the database must reject task rewards that exceed the daily cap');
assert.match(schema, /daily_task_submissions/);
assert.match(schema, /daily_task_assignments/);
assert.match(schema, /daily_task_entities/);
assert.match(schema, /enable row level security/i);
assert.match(schema, /grant execute on function public\.operix_daily_task_complete_atomic\(uuid, text\) to service_role/i);
assert.match(migration, /create or replace function public\.operix_daily_task_complete_atomic/i);
assert.doesNotMatch(migration, /COMMUNITY_TASK_REQUIRED|OPTIONAL_TASK_NO_REWARD|tier_code \|\| '-community'/i, 'database migration must not keep the removed community task rules');
assert.match(migration, /EVALUATION_REQUIRED/);
assert.match(adminController, /evaluationCount \+ 1/, 'task count must follow the fixed community task plus the admin-controlled evaluation count');
assert.match(client, /button\.disabled = !currentUserTierActive/, 'the daily task card must remain an entry to the plan after all tasks are marked complete');
assert.match(client, /id: 'daily',[^\n]*done: false/, 'stale completion counters must not remove the daily-plan entry');
assert.match(client, /data\.taskLimit \?\? data\.tier\?\.taskLimit/, 'the task detail panel must read the total from the API tier payload');
assert.match(client, /filter\(task => !task\.completed\)/, 'the paid task board must show only remaining tasks without a community card');
assert.match(client, /targetImageUrl.*alt.*targetName|brand.*task\.targetName/, 'the paid-task panel must show the evaluation brand logo and company name in a premium card');
assert.match(client, /style="width:96px;height:48px".*object-fit:contain/, 'the company logo should use a fixed landscape tile and preserve the source aspect ratio');
assert.doesNotMatch(client, /ملاحظة قصيرة|data-evaluation-field="feedback"/, 'the task evaluation form must not ask for a short note');
assert.match(client, /data-task-cooldown/, 'the only next task should show a cooldown countdown when locked');
assert.match(client, /slice\(0,\s*5\)/, 'the visible daily list must never exceed five active tasks');
assert.doesNotMatch(client, /مشاركة مجتمعية اختيارية — خارج المهام المدفوعة/, 'community engagement must no longer be exposed as a separate task');
assert.doesNotMatch(client, /isCommunityTask \? "switchTab\('feed'\)" : isEvaluationTask/, 'the client must no longer treat the community task as a distinct card');

(async () => {
  const userBackup = dataAccess.user.findById;
  const vipBackup = dataAccess.vipLevel.findOne;
  const socialBackup = dataAccess.socialPost.find;
  const assignmentBackup = dataAccess.dailyTaskAssignment.find;
  const assignmentFindOneBackup = dataAccess.dailyTaskAssignment.findOne;
  const submissionBackup = dataAccess.dailyTaskSubmission.find;
  const submissionFindOneBackup = dataAccess.dailyTaskSubmission.findOne;
  const submissionUpdateOneBackup = dataAccess.dailyTaskSubmission.updateOne;
  const submissionCreateBackup = dataAccess.dailyTaskSubmission.create;
  const completionBackup = dataAccess.dailyTaskCompletion.find;
  const completionFindOneBackup = dataAccess.dailyTaskCompletion.findOne;
  const callSupabaseRpcBackup = dataAccess.callSupabaseRpc;

  try {
    dataAccess.user.findById = async () => ({ id: 'user-1', tierCode: 'A1', wallet: { totalDeposits: 50 } });
    dataAccess.vipLevel.findOne = async () => ({ code: 'A1', name: 'A1', tasks: 3, dailyProfit: 1.5 });
    dataAccess.socialPost.find = async () => [];
    dataAccess.dailyTaskAssignment.find = async ({ userId, tierCode, taskDate }) => {
      if (userId === 'user-1' && tierCode === 'A1' && taskDate) {
        return [
          { taskNumber: 1, entityName: 'Alpha Systems', category: 'technology', entityKey: 'wiki:alpha-systems', summary: 'Alpha summary', createdAt: new Date('2031-06-01T12:00:00.000Z').toISOString() },
          { taskNumber: 2, entityName: 'Beta Systems', category: 'technology', entityKey: 'wiki:beta-systems', summary: 'Beta summary', createdAt: new Date('2031-06-01T12:00:00.000Z').toISOString() },
          { taskNumber: 3, entityName: 'Gamma Systems', category: 'technology', entityKey: 'wiki:gamma-systems', summary: 'Gamma summary', createdAt: new Date('2031-06-01T12:00:00.000Z').toISOString() }
        ];
      }
      return [];
    };
    dataAccess.dailyTaskAssignment.findOne = async ({ userId, tierCode, taskDate, taskNumber }) => {
      if (userId === 'user-5' && tierCode === 'A1' && taskDate && taskNumber === 5) {
        return { id: 'assignment-5', taskNumber: 5, category: 'technology', entityKey: 'wiki:delta-systems', entityName: 'Delta Systems', allowedTags: ['الأمان', 'الشفافية', 'المنفعة'] };
      }
      return null;
    };
    dataAccess.dailyTaskSubmission.find = async () => [];
    dataAccess.dailyTaskSubmission.findOne = async () => null;
    dataAccess.dailyTaskSubmission.updateOne = async () => ({ success: true });
    dataAccess.dailyTaskSubmission.create = async () => ({ success: true });
    dataAccess.dailyTaskCompletion.find = async ({ userId, taskDate }) => {
      if (userId === 'user-5' && taskDate) {
        return [
          { taskKey: 'A1-task-01' },
          { taskKey: 'A1-task-02' },
          { taskKey: 'A1-task-03' },
          { taskKey: 'A1-task-04' }
        ];
      }
      return [];
    };
    dataAccess.dailyTaskCompletion.findOne = async () => null;
    dataAccess.callSupabaseRpc = async () => ({ success: true, taskKey: 'A1-task-05', grossAmount: 0.45 });

    const req = { user: { id: 'user-1' } };
    let latestPayload = null;
    const res = {
      json(payload) {
        latestPayload = payload;
        assert.ok(Array.isArray(payload.tasks), 'returned task list must be an array');
        assert.ok(payload.tasks.length > 0, 'a valid active tier must still expose at least the first task');
        assert.equal(payload.tasks[0].taskKey, 'A1-task-01');
      },
      status() { return { json() { throw new Error('unexpected error response'); } }; }
    };

    await activityController.getDailyTasks(req, res);
    assert.equal(latestPayload.tasks[0].locked, false, 'the first paid task must be executable immediately when the daily plan starts');

    const tierFiveReq = {
      user: { id: 'user-5' },
      body: { taskKey: 'A1-task-05', rating: 4, selectedTag: 'الخصوصية' }
    };
    const tierFiveRes = {
      statusCode: null,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return payload; }
    };
    dataAccess.user.findById = async () => ({ id: 'user-5', tierCode: 'A1', wallet: { totalDeposits: 50 } });
    dataAccess.vipLevel.findOne = async () => ({ code: 'A1', name: 'A1', tasks: 5, dailyProfit: 2.5 });
    dataAccess.dailyTaskAssignment.find = async ({ userId, tierCode, taskDate }) => {
      if (userId === 'user-5' && tierCode === 'A1' && taskDate) {
        const planStarted = Date.now() - 10 * 60 * 60 * 1000;
        return [
          { taskNumber: 1, category: 'technology', entityKey: 'wiki:alpha-systems', entityName: 'Alpha Systems', allowedTags: ['الأمان', 'الشفافية'], createdAt: new Date(planStarted).toISOString() },
          { taskNumber: 2, category: 'technology', entityKey: 'wiki:beta-systems', entityName: 'Beta Systems', allowedTags: ['الأمان', 'الشفافية'], createdAt: new Date(planStarted).toISOString() },
          { taskNumber: 3, category: 'technology', entityKey: 'wiki:gamma-systems', entityName: 'Gamma Systems', allowedTags: ['الأمان', 'الشفافية'], createdAt: new Date(planStarted).toISOString() },
          { taskNumber: 4, category: 'technology', entityKey: 'wiki:delta-systems', entityName: 'Delta Systems', allowedTags: ['الأمان', 'الشفافية'], createdAt: new Date(planStarted).toISOString() },
          { taskNumber: 5, category: 'technology', entityKey: 'wiki:epsilon-systems', entityName: 'Epsilon Systems', allowedTags: ['الأمان', 'الشفافية'], createdAt: new Date(planStarted).toISOString() }
        ];
      }
      return [];
    };
    await activityController.submitDailyEvaluation(tierFiveReq, tierFiveRes);
    assert.equal(tierFiveRes.statusCode, null, 'the final paid task should still be executable when the tier contains five paid tasks');
    assert.equal(tierFiveRes.payload.success, true, 'the valid task five submission should succeed');
  } finally {
    dataAccess.user.findById = userBackup;
    dataAccess.vipLevel.findOne = vipBackup;
    dataAccess.socialPost.find = socialBackup;
    dataAccess.dailyTaskAssignment.find = assignmentBackup;
    dataAccess.dailyTaskAssignment.findOne = assignmentFindOneBackup;
    dataAccess.dailyTaskSubmission.find = submissionBackup;
    dataAccess.dailyTaskSubmission.findOne = submissionFindOneBackup;
    dataAccess.dailyTaskSubmission.updateOne = submissionUpdateOneBackup;
    dataAccess.dailyTaskSubmission.create = submissionCreateBackup;
    dataAccess.dailyTaskCompletion.find = completionBackup;
    dataAccess.dailyTaskCompletion.findOne = completionFindOneBackup;
    dataAccess.callSupabaseRpc = callSupabaseRpcBackup;
  }
})();

console.log('daily-task-board test: OK');
