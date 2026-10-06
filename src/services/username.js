const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidUsername(value) {
  return EMAIL_PATTERN.test(normalizeUsername(value));
}

function usernameFromEmail(email) {
  return normalizeUsername(email);
}

module.exports = { EMAIL_PATTERN, normalizeUsername, isValidUsername, usernameFromEmail };
