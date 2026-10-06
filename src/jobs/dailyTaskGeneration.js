const cron = require('node-cron');
const { refreshDailyEntityPool, utcDateString, TASK_TIME_ZONE } = require('../services/dailyTaskAutomation');

async function generateDailyTaskEntities() {
  const entities = await refreshDailyEntityPool();
  const counts = entities.reduce((result, entity) => {
    result[entity.category] = (result[entity.category] || 0) + 1;
    return result;
  }, {});
  return { date: utcDateString(), total: entities.length, byCategory: counts };
}

function scheduleDailyTaskGeneration() {
  cron.schedule('5 0 * * *', () => {
    generateDailyTaskEntities().catch(error => console.error('Daily evaluation entity generation failed:', error.message));
  }, { timezone: TASK_TIME_ZONE });
  console.log(`Daily evaluation entity rotation scheduled for 00:05 ${TASK_TIME_ZONE}`);
}

module.exports = { generateDailyTaskEntities, scheduleDailyTaskGeneration };
