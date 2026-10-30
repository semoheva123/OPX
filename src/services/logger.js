// Structured logging for server-side observability.
//
// Every line is a single JSON object so Vercel (or any log drain) can index it. Secrets are never
// logged: callers pass an allow-listed set of fields and anything that looks like a credential is
// redacted here as a second line of defence.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = String(process.env.LOG_LEVEL || '').toLowerCase();
const minimumLevel = LEVELS[configuredLevel] || (process.env.NODE_ENV === 'test' ? LEVELS.error : LEVELS.info);
const pretty = String(process.env.LOG_FORMAT || '').toLowerCase() === 'pretty';

const REDACTED = '[redacted]';
const SENSITIVE_FIELD = /(password|secret|token|authorization|cookie|key|signature|otp|code)/i;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: truncate(value.stack, 2000) };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    Object.entries(value).forEach(([key, item]) => {
      if (SENSITIVE_FIELD.test(key)) {
        result[key] = REDACTED;
        return;
      }
      result[key] = sanitize(item, depth + 1);
    });
    return result;
  }
  if (typeof value === 'string') return truncate(value, 2000);
  return value;
}

function truncate(value, limit) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function emit(level, message, fields = {}) {
  if ((LEVELS[level] || LEVELS.info) < minimumLevel) return;
  // Base fields win: a payload must never mask the event name or the level.
  const entry = {
    ...sanitize(fields),
    time: new Date().toISOString(),
    level,
    message
  };
  const line = pretty
    ? `${entry.time} ${level.toUpperCase()} ${message} ${JSON.stringify(sanitize(fields))}`
    : JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  debug: (message, fields) => emit('debug', message, fields),
  info: (message, fields) => emit('info', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  error: (message, fields) => emit('error', message, fields),
  sanitize,
  truncate
};
