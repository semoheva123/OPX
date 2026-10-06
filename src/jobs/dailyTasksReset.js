const cron = require('node-cron');
const dataAccess = require('../services/dataAccess');
const { TASK_TIME_ZONE } = require('../services/taskCalendar');
const User = dataAccess.user;

async function resetDailyTasks() {
  try {
    const result = await User.updateMany({}, { $set: { todayCompletedTasks: 0 } });
    console.log(`✅ تم إعادة تعيين المهام اليومية: ${result.modifiedCount} سجل معدل من أصل ${result.matchedCount}`);
  } catch (error) {
    console.error('❌ فشل إعادة تعيين المهام اليومية:', error);
  }
}

function scheduleDailyTaskReset() {
  cron.schedule('0 0 * * *', resetDailyTasks, { timezone: TASK_TIME_ZONE });
  console.log(`⏰ تمت جدولة إعادة تعيين المهام اليومية عند 00:00 ${TASK_TIME_ZONE}`);
}

module.exports = { resetDailyTasks, scheduleDailyTaskReset };
