const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const adminHtml = read('admin.html');
const adminLogin = read('admin-login.html');
const appSource = read('src/app.js');
const adminRoutes = read('src/routes/adminRoutes.js');
const adminController = read('src/controllers/adminController.js');
const supportController = read('src/controllers/supportController.js');
const authMiddleware = read('src/middlewares/auth.js');
const migration = read('supabase/admin-audit-hardening.sql');

// 1. The console must never keep the admin bearer token in web storage.
assert.doesNotMatch(adminHtml, /localStorage\.setItem\('adminToken'/, 'admin console must not persist the admin token');
assert.doesNotMatch(adminHtml, /adminStorageGetItem\('adminToken'\)/, 'admin console must not read the admin token from storage');
assert.doesNotMatch(adminLogin, /localStorage\.setItem\('adminToken'/, 'admin login must rely on the HttpOnly cookie only');
assert.match(adminHtml, /credentials: 'same-origin'/, 'admin requests must send the session cookie');
assert.match(adminHtml, /new EventSource\('\/api\/realtime\/stream', \{ withCredentials: true \}\)/, 'realtime stream must authenticate with the session cookie');

// 2. Session management and audit export must exist end to end.
assert.match(adminRoutes, /router\.get\('\/audit-logs\/export'/, 'audit export route is required');
assert.match(adminRoutes, /router\.get\('\/security\/sessions'/, 'admin session listing route is required');
assert.match(adminRoutes, /router\.post\('\/security\/sessions\/revoke-others'/, 'revoke-other-sessions route is required');
assert.match(adminRoutes, /router\.get\('\/security\/2fa', authController\.adminSecurityStatus\)/, '2FA status must be readable by every admin role');
assert.doesNotMatch(adminRoutes, /router\.get\('\/security\/2fa', requireFullAdmin/, '2FA status must not be limited to full admins');
assert.match(adminHtml, /loadAdminSessions\(\)/, 'admin console must render admin sessions');
assert.match(adminHtml, /revokeOtherAdminSessions\(\)/, 'admin console must expose revoke-other-sessions');

// 3. Balance adjustments must be auditable with a reason and before/after values.
assert.match(adminController, /const reason = String\(req\.body\.reason \|\| ''\)\.trim\(\)\.slice\(0, 300\)/, 'balance changes must accept a reason');
assert.match(adminController, /p_reason: reason \|\| 'admin_adjustment'/, 'balance RPC must receive the operator reason');
assert.match(adminController, /oldValue: previousWallet/, 'audit entry must record the previous wallet balance');
assert.match(adminHtml, /editUserBalanceReason/, 'balance modal must require a reason');
assert.match(adminHtml, /updateBalancePreview\(\)/, 'balance modal must preview before/after values');

// 4. Server-side listing must replace in-memory scans when available.
assert.match(adminController, /admin_audit_logs_page/, 'audit reads must use the paginated RPC');
assert.match(adminController, /fetchAuditLogsViaRpc/, 'audit pagination helper is required');
assert.match(migration, /create or replace function public\.admin_audit_logs_page/, 'migration must install the pagination RPC');
assert.match(migration, /grant execute on function public\.admin_audit_logs_page[^;]+to service_role;/i, 'pagination RPC must be service-role only');
assert.match(supportController, /totalPages: Math\.max\(1, Math\.ceil\(total \/ limit\)\)/, 'support tickets must be paginated');
assert.match(supportController, /counts: countsPayload/, 'support tickets must return status counters');

// 5. Request hardening.
assert.match(appSource, /const mutatingMethods = new Set\(\['POST', 'PUT', 'PATCH', 'DELETE'\]\)/, 'mutating requests must be origin checked');
assert.match(appSource, /طلب غير موثوق: مصدر الطلب غير مسموح/, 'origin rejection message is required');
assert.match(appSource, /app\.use\('\/api\/admin\/', rateLimit\(/, 'admin API needs its own rate limit');
assert.match(appSource, /skip: req => req\.path\.startsWith\('\/admin\/'\)/, 'admin API must be excluded from the generic user limit');
assert.match(appSource, /app\.use\('\/api\/auth\/admin-login', rateLimit\(/, 'admin login needs a dedicated limit');
assert.match(appSource, /readCookieToken\(req\)/, 'realtime endpoints must accept the session cookie');
assert.match(appSource, /'X-Robots-Tag': 'noindex, nofollow'/, 'admin.html must never be indexed');

// 6. Role permissions stay aligned between middleware and client.
assert.match(authMiddleware, /monitor: \['read_overview', 'read_users', 'read_audit', 'read_referrals'\]/, 'monitor permissions must remain read-only');
assert.match(adminHtml, /monitor: \['read_overview', 'read_users', 'read_audit', 'read_referrals'\]/, 'client permissions must mirror the server');
assert.match(adminHtml, /function tabAllowed\(tab\)/, 'client must enforce tab permissions');
assert.match(adminHtml, /applyRoleVisibility\(\);\n            markAdminSync\(\);|applyRoleVisibility\(\);/, 'role visibility must be re-applied after tab switches');

async function request(port, method, urlPath, { origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (origin) headers.Origin = origin;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: data, headers: response.headers }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-admin-hardening';
  process.env.DATABASE_MODE = 'supabase';
  process.env.NODE_ENV = 'test';
  delete process.env.ALLOWED_ORIGINS;

  const createApp = require('../src/app');
  const app = createApp({ resend: null, webpush: null, gameSettings: null });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const foreignOrigin = await request(port, 'POST', '/api/admin/users/update', { origin: 'https://evil.example', body: { userId: 'x', balance: 1 } });
    assert.equal(foreignOrigin.status, 403, 'cross-origin admin mutation must be rejected');

    const foreignLogin = await request(port, 'POST', '/api/auth/admin-login', { origin: 'https://evil.example', body: { email: 'a@b.c', password: 'x' } });
    assert.equal(foreignLogin.status, 403, 'cross-origin admin login must be rejected');

    const sameOrigin = await request(port, 'POST', '/api/admin/users/update', { origin: `http://127.0.0.1:${port}`, body: { userId: 'x', balance: 1 } });
    assert.notEqual(sameOrigin.status, 403, 'same-origin admin mutation must pass the origin guard');

    const auditExport = await request(port, 'GET', '/api/admin/audit-logs/export');
    assert.equal(auditExport.status, 401, 'audit export must require an admin session');

    const sessions = await request(port, 'GET', '/api/admin/security/sessions');
    assert.equal(sessions.status, 401, 'admin sessions endpoint must require an admin session');

    const stream = await request(port, 'GET', '/api/realtime/stream');
    assert.equal(stream.status, 401, 'realtime stream must reject unauthenticated requests');

    const health = await request(port, 'GET', '/api/health');
    assert.equal(health.status, 200, 'health endpoint must stay public');
    assert.match(health.body, /"status"/, 'health payload must be JSON');

    const adminPage = await request(port, 'GET', '/admin.html');
    assert.equal(adminPage.status, 302, 'admin.html must not be served without an admin session');
    assert.equal(adminPage.headers?.location, '/admin-login.html', 'unauthenticated admin visits must be redirected to the login page');

    console.log('admin console hardening tests: ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
