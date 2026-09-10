const cron = require('node-cron');
const User = require('../models/User');

async function resetDailyTasks() {
  try {
    const result = await User.updateMany({}, { $set: { todayCompletedTasks: 0 } });
    console.log(`✅ تم إعادة تعيين المهام اليومية: ${result.modifiedCount} سجل معدل من أصل ${result.matchedCount}`);
  } catch (error) {
    console.error('❌ فشل إعادة تعيين المهام اليومية:', error);
  }
}

function scheduleDailyTaskReset() {
  cron.schedule('0 0 * * *', resetDailyTasks, { timezone: 'UTC' });
  console.log('⏰ تمت جدولة إعادة تعيين المهام اليومية عند 00:00 UTC');
}

module.exports = { resetDailyTasks, scheduleDailyTaskReset };
