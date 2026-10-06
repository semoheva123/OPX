const TASK_TIME_ZONE = 'Europe/Istanbul';

function getTaskDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TASK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function taskDateString(value = new Date()) {
  const { year, month, day } = getTaskDateParts(value);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function startOfTaskDay(value = new Date()) {
  const { year, month, day } = getTaskDateParts(value);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const localAtUtcMidnight = new Intl.DateTimeFormat('en-US', {
    timeZone: TASK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(utcMidnight));
  const localParts = Object.fromEntries(localAtUtcMidnight
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  const localAsUtc = Date.UTC(localParts.year, localParts.month - 1, localParts.day, localParts.hour, localParts.minute, localParts.second);
  return new Date(utcMidnight - (localAsUtc - utcMidnight));
}

function getTaskDayOfWeek(value = new Date()) {
  const { year, month, day } = getTaskDateParts(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

module.exports = { TASK_TIME_ZONE, taskDateString, startOfTaskDay, getTaskDayOfWeek };