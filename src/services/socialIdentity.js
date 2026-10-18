const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeSocialName(value, fallback = 'عضو OPERIX') {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  const email = normalized.match(EMAIL_PATTERN);
  if (email) return normalized.slice(0, normalized.lastIndexOf('@')) || fallback;
  return normalized;
}

function socialNameFor(user) {
  const email = String(user?.email || '').trim();
  const isOfficial = Boolean(user?.isOfficialPlatform || user?.metadata?.officialPlatform || email.toLowerCase() === 'official@operix.website');
  if (isOfficial) return 'OPERIX Official';
  const preferred = String(user?.displayName || user?.name || '').trim();
  if (preferred && !EMAIL_PATTERN.test(preferred)) return preferred;
  const username = String(user?.username || '').trim();
  if (username && !EMAIL_PATTERN.test(username)) return username;
  return safeSocialName(email);
}

function socialHandleFor(user) {
  const name = socialNameFor(user);
  const handle = name.toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, '').slice(0, 30);
  return handle ? `@${handle}` : '@operix_member';
}

module.exports = { safeSocialName, socialNameFor, socialHandleFor };
