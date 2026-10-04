const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const activityController = require('../src/controllers/activityController');
const automation = require('../src/services/dailyTaskAutomation');
const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase/schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/automated-daily-tasks.sql'), 'utf8');
const adminController = fs.readFileSync(path.join(__dirname, '..', 'src/controllers/adminController.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

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
const stripeTask = activityController.buildDailyTasks('A1', [
	{ entityKey: 'finance:stripe', entityName: 'Stripe, Inc.', category: 'finance', summary: 'خدمة مالية.', imageUrl: '', submissionComplete: false }
], new Set(), false, 1)[1];
assert.equal(stripeTask.targetImageUrl, 'https://www.google.com/s2/favicons?domain=stripe.com&sz=128', 'known brands should use the favicon hosted by their official domain when task data has no image');
assert.equal(automation.getOfficialBrandLogoUrl('Intel'), 'https://www.google.com/s2/favicons?domain=intel.com&sz=128');
assert.equal(automation.getOfficialBrandLogoUrl('MetaTrader'), 'https://www.metatrader5.com/i/metatrader-5-logo.png');
assert.ok(tasks.every(task => task.reward > 0));
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
assert.match(client, /h-12 w-24.*object-fit:contain/, 'the company logo should use a landscape tile and preserve the source aspect ratio');

console.log('daily-task-board test: OK');
