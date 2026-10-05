const crypto = require('node:crypto');

const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,23}$/;

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function isValidUsername(value) {
  return USERNAME_PATTERN.test(normalizeUsername(value));
}

function usernameFromEmail(email) {
  const localPart = String(email || '').split('@')[0].toLowerCase();
  const base = localPart.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const safeBase = /^[a-z]/.test(base) ? base : `user_${base}`;
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${safeBase.slice(0, 16)}_${suffix}`.slice(0, 24);
}

module.exports = { USERNAME_PATTERN, normalizeUsername, isValidUsername, usernameFromEmail };
