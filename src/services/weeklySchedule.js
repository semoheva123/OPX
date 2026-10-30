const UTC_WEEKDAYS = Object.freeze({
  SUNDAY: 0,
  FRIDAY: 5,
  SATURDAY: 6
});
const TASK_TIME_ZONE = 'Europe/Istanbul';

function getUtcDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

function getTaskDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TASK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return new Date(Date.UTC(values.year, values.month - 1, values.day)).getUTCDay();
}

function isTaskHoliday(value = new Date()) {
  const day = getTaskDay(value);
  return day === UTC_WEEKDAYS.FRIDAY;
}

function getTaskSchedule(value = new Date()) {
  const day = getTaskDay(value);
  const dayName = day === UTC_WEEKDAYS.FRIDAY ? 'الجمعة' : null;
  return {
    dayOfWeek: day,
    timezone: TASK_TIME_ZONE,
    holiday: dayName !== null,
    dayName,
    message: dayName ? `عطلة المهام الأسبوعية: لا توجد مهام يوم ${dayName}.` : null
  };
}

function getWithdrawalSchedule(tierCode, value = new Date()) {
  const normalizedTier = String(tierCode || '').trim().toUpperCase();
  return {
    tierCode: normalizedTier,
    allowedDay: null,
    allowedDayName: 'كل أيام الأسبوع',
    currentDay: getTaskDay(value),
    allowed: true,
    timezone: TASK_TIME_ZONE,
    nextAvailableAt: null,
    message: `يمكنك تقديم طلب السحب يوميًا، طوال أيام الأسبوع (${TASK_TIME_ZONE}).`
  };
}

module.exports = { UTC_WEEKDAYS, TASK_TIME_ZONE, getUtcDay, getTaskDay, isTaskHoliday, getTaskSchedule, getWithdrawalSchedule };
