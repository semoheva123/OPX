const UTC_WEEKDAYS = Object.freeze({
  SUNDAY: 0,
  FRIDAY: 5,
  SATURDAY: 6
});
const TASK_TIME_ZONE = 'Europe/Istanbul';
const { startOfTaskDay } = require('./taskCalendar');

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
  return day === UTC_WEEKDAYS.FRIDAY || day === UTC_WEEKDAYS.SATURDAY;
}

function getTaskSchedule(value = new Date()) {
  const day = getTaskDay(value);
  const dayName = day === UTC_WEEKDAYS.FRIDAY ? 'الجمعة' : day === UTC_WEEKDAYS.SATURDAY ? 'السبت' : null;
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
  const isEntryTier = normalizedTier === 'A1' || normalizedTier === 'A2';
  const allowedDay = isEntryTier ? UTC_WEEKDAYS.FRIDAY : UTC_WEEKDAYS.SATURDAY;
  const currentDay = getTaskDay(value);
  const allowedDayName = isEntryTier ? 'الجمعة' : 'السبت';
  const allowed = currentDay === allowedDay;
  let nextAvailableAt = null;

  if (!allowed && currentDay !== null) {
    const todayStart = startOfTaskDay(value);
    const daysUntil = (allowedDay - currentDay + 7) % 7 || 7;
    nextAvailableAt = new Date(todayStart.getTime() + daysUntil * 24 * 60 * 60 * 1000).toISOString();
  }

  return {
    tierCode: normalizedTier,
    allowedDay,
    allowedDayName,
    currentDay,
    allowed,
    timezone: TASK_TIME_ZONE,
    nextAvailableAt,
    message: allowed
      ? `يمكنك تقديم طلب السحب اليوم (${allowedDayName}، ${TASK_TIME_ZONE}).`
      : `طلبات السحب لهذا المستوى متاحة يوم ${allowedDayName} فقط (${TASK_TIME_ZONE}).`
  };
}

module.exports = { UTC_WEEKDAYS, TASK_TIME_ZONE, getUtcDay, getTaskDay, isTaskHoliday, getTaskSchedule, getWithdrawalSchedule };
