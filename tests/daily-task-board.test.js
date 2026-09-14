const assert = require('node:assert/strict');
const activityController = require('../src/controllers/activityController');

const tasks = activityController.buildDailyTasks('A1', 8, new Set(), false);

assert.equal(Array.isArray(tasks), true, 'يجب أن تُعيد قائمة مهام');
assert.equal(tasks.length, 8, 'يجب أن يكون عدد المهام مطابقًا لمستوى A1');
assert.equal(typeof tasks[0].title, 'string', 'يجب أن تحتوي المهمة على عنوان');
assert.equal(typeof tasks[0].instructions, 'object', 'يجب أن تحتوي المهمة على إرشادات');
assert.equal(tasks[0].instructions.length > 0, true, 'يجب أن تحتوي المهمة على تعليمات');
assert.equal(typeof tasks[0].reward, 'number', 'يجب أن تحتوي المهمة على قيمة مكافأة');

console.log('daily-task-board test: OK');
