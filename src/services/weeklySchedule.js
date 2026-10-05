const UTC_WEEKDAYS = Object.freeze({
  SUNDAY: 0,
  FRIDAY: 5,
  SATURDAY: 6
});

function getUtcDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

function isTaskHoliday(value = new Date()) {
  const day = getUtcDay(value);
  return day === UTC_WEEKDAYS.FRIDAY || day === UTC_WEEKDAYS.SATURDAY;
}

function getTaskSchedule(value = new Date()) {
  const day = getUtcDay(value);
  const dayName = day === UTC_WEEKDAYS.FRIDAY ? 'الجمعة' : day === UTC_WEEKDAYS.SATURDAY ? 'السبت' : null;
  return {
    dayOfWeek: day,
    timezone: 'UTC',
    holiday: dayName !== null,
    dayName,
    message: dayName ? `عطلة المهام الأسبوعية: لا توجد مهام يوم ${dayName}.` : null
  };
}

function getWithdrawalSchedule(tierCode, value = new Date()) {
  const normalizedTier = String(tierCode || '').trim().toUpperCase();
  const isEntryTier = normalizedTier === 'A1' || normalizedTier === 'A2';
  const allowedDay = isEntryTier ? UTC_WEEKDAYS.FRIDAY : UTC_WEEKDAYS.SATURDAY;
  const currentDay = getUtcDay(value);
  const allowedDayName = isEntryTier ? 'الجمعة' : 'السبت';
  const allowed = currentDay === allowedDay;
  let nextAvailableAt = null;

  if (!allowed && currentDay !== null) {
    const now = value instanceof Date ? value : new Date(value);
    const daysUntil = (allowedDay - currentDay + 7) % 7 || 7;
    nextAvailableAt = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntil
    )).toISOString();
  }

  return {
    tierCode: normalizedTier,
    allowedDay,
    allowedDayName,
    currentDay,
    allowed,
    timezone: 'UTC',
    nextAvailableAt,
    message: allowed
      ? `يمكنك تقديم طلب السحب اليوم (${allowedDayName}، UTC).`
      : `طلبات السحب لهذا المستوى متاحة يوم ${allowedDayName} فقط (UTC).`
  };
}

module.exports = { UTC_WEEKDAYS, getUtcDay, isTaskHoliday, getTaskSchedule, getWithdrawalSchedule };
