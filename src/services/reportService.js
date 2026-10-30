// Retention and cohort analytics for the admin console.
//
// A cohort is the ISO week a user signed up in. Retention for cohort C at week N is the share of
// that cohort which showed any activity during week C+N. Activity comes from two sources: a
// transaction the user created, and lastLoginAt. Numbers are computed from raw rows so the same
// function can be unit tested without a database.
const dataAccess = require('./dataAccess');

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50000;
const MAX_WEEKS = 26;

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Monday 00:00 UTC of the week containing `value`; ISO-style week keys sort lexicographically.
function startOfWeek(value) {
  const date = toDate(value);
  if (!date) return null;
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - weekday);
  return utc;
}

function weekKey(value) {
  const start = startOfWeek(value);
  return start ? start.toISOString().slice(0, 10) : null;
}

function weeksBetween(fromKey, toKey) {
  const from = new Date(`${fromKey}T00:00:00Z`).getTime();
  const to = new Date(`${toKey}T00:00:00Z`).getTime();
  return Math.round((to - from) / (7 * DAY_MS));
}

function shiftWeek(key, offset) {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + offset * 7 * DAY_MS).toISOString().slice(0, 10);
}

function userIdOf(row) {
  const raw = row?.userId ?? row?.user ?? row?.user_id;
  if (raw && typeof raw === 'object') return String(raw.id || raw._id || raw.userId || '');
  return raw === undefined || raw === null ? '' : String(raw);
}

function calculateRetentionCohorts({ users = [], transactions = [], weeks = 8, now = new Date() } = {}) {
  const periods = Math.max(1, Math.min(MAX_WEEKS, Number(weeks) || 8));
  const currentWeek = weekKey(now);
  const firstWeek = shiftWeek(currentWeek, -(periods - 1));

  // activity[userId] = Set of week keys where the user did something.
  const activity = new Map();
  const markActivity = (userId, timestamp) => {
    const key = weekKey(timestamp);
    if (!userId || !key) return;
    if (!activity.has(userId)) activity.set(userId, new Set());
    activity.get(userId).add(key);
  };
  transactions.forEach(transaction => markActivity(userIdOf(transaction), transaction.createdAt));

  const cohorts = new Map();
  const signupWeekByUser = new Map();
  users.forEach(user => {
    const id = String(user.id || user._id || '');
    const signupWeek = weekKey(user.createdAt);
    if (!id || !signupWeek) return;
    if (signupWeek < firstWeek) return;
    const bucket = cohorts.get(signupWeek) || { cohort: signupWeek, size: 0, retained: new Map(), revenue: new Map() };
    bucket.size += 1;
    if (!bucket.members) bucket.members = new Set();
    bucket.members.add(id);
    signupWeekByUser.set(id, signupWeek);
    // Signing up counts as activity in the cohort's first week, so week 0 is always the base.
    markActivity(id, user.createdAt);
    markActivity(id, user.lastLoginAt);
    cohorts.set(signupWeek, bucket);
  });

  transactions.forEach(transaction => {
    const id = userIdOf(transaction);
    const key = weekKey(transaction.createdAt);
    if (!id || !key) return;
    if (transaction.type !== 'deposit' || transaction.status !== 'approved') return;
    const bucket = cohorts.get(signupWeekByUser.get(id));
    if (!bucket) return;
    bucket.revenue.set(key, (bucket.revenue.get(key) || 0) + Number(transaction.amount || 0));
  });

  const rows = [...cohorts.values()]
    .sort((a, b) => a.cohort.localeCompare(b.cohort))
    .map(bucket => {
      const cells = [];
      for (let index = 0; index < periods; index += 1) {
        const key = shiftWeek(bucket.cohort, index);
        if (key > currentWeek) break;
        const active = [...bucket.members].filter(member => activity.get(member)?.has(key)).length;
        cells.push({
          week: key,
          offset: index,
          activeUsers: active,
          rate: bucket.size ? Number(((active / bucket.size) * 100).toFixed(2)) : 0,
          deposits: Number((bucket.revenue.get(key) || 0).toFixed(2))
        });
      }
      const totalDeposits = [...bucket.revenue.values()].reduce((sum, value) => sum + value, 0);
      const firstCell = cells[0] || { activeUsers: 0 };
      return {
        cohort: bucket.cohort,
        size: bucket.size,
        newUsers: bucket.size,
        week0Active: firstCell.activeUsers,
        retention: cells,
        latestRate: cells.length ? cells[cells.length - 1].rate : 0,
        totalDeposits: Number(totalDeposits.toFixed(2)),
        depositsPerUser: bucket.size ? Number((totalDeposits / bucket.size).toFixed(2)) : 0
      };
    });

  const weeklyActive = new Map();
  activity.forEach(weekSet => weekSet.forEach(key => {
    if (key < firstWeek || key > currentWeek) return;
    weeklyActive.set(key, (weeklyActive.get(key) || 0) + 1);
  }));
  const activeSeries = [];
  for (let index = 0; index < periods; index += 1) {
    const key = shiftWeek(firstWeek, index);
    if (key > currentWeek) break;
    activeSeries.push({ week: key, activeUsers: weeklyActive.get(key) || 0 });
  }
  const totalCohortUsers = rows.reduce((sum, row) => sum + row.size, 0);
  const week0 = activeSeries[0]?.activeUsers || 0;
  const latestWeek = activeSeries[activeSeries.length - 1]?.activeUsers || 0;
  const firstWeekRetention = rows.length ? Number(rows.reduce((sum, row) => {
    const cell = row.retention[1];
    return sum + (cell ? cell.rate * row.size : 0);
  }, 0) / Math.max(1, totalCohortUsers) || 0) : 0;

  return {
    generatedAt: new Date(now).toISOString(),
    weeks: periods,
    periodStart: firstWeek,
    periodEnd: currentWeek,
    totals: {
      cohortUsers: totalCohortUsers,
      cohorts: rows.length,
      weeklyActiveUsers: latestWeek,
      week0ActiveUsers: week0,
      week1RetentionRate: Number(firstWeekRetention.toFixed(2)),
      trackedActiveUsers: activity.size
    },
    activeSeries,
    cohorts: rows
  };
}

async function buildRetentionReport(weeks = 8, now = new Date()) {
  const periods = Math.max(1, Math.min(MAX_WEEKS, Number(weeks) || 8));
  const since = new Date(new Date(now).getTime() - (periods + 1) * 7 * DAY_MS);
  const [users, transactions] = await Promise.all([
    dataAccess.user.find({}, { limit: PAGE_SIZE }),
    dataAccess.transaction.find({ createdAt: { $gte: since } }, { sort: { createdAt: -1 }, limit: PAGE_SIZE })
  ]);
  return calculateRetentionCohorts({ users, transactions, weeks: periods, now });
}

module.exports = { calculateRetentionCohorts, buildRetentionReport, startOfWeek, weekKey, shiftWeek, userIdOf };
