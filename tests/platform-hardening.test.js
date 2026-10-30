// Platform-wide hardening: health exposure, request limits, auth rate budgets, request-body caps,
// client boot safety and polling cadence. Each block is either a static guarantee or a live HTTP check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const appSource = read('src/app.js');
const clientSource = read('app.js');
const serverSource = read('server.js');
const indexHtml = read('index.html');
const adminHtml = read('admin.html');

// --- 1. Static guarantees -------------------------------------------------------------------------
// The ticker state must be declared before initializePlatform() can run; otherwise a script that is
// evaluated after DOMContentLoaded throws a temporal-dead-zone ReferenceError and never boots.
assert.ok(clientSource.indexOf('let liveTickerEvents = [];') < clientSource.indexOf('function initializePlatform()'),
  'ticker state must be declared before initializePlatform so the app can boot at any load time');
assert.match(clientSource, /String\(modal\.querySelector\('h1, h2, h3'\)\?\.textContent \|\| ''\)\.trim\(\)/,
  'modal labels must read textContent (innerText is undefined outside a layout engine)');
assert.match(clientSource, /requestAnimationFrame\(\(\) => \{\n\s*modalSyncFrame = 0;\n\s*syncModalAccessibility\(\);/,
  'modal accessibility work must be coalesced into one animation frame');
assert.match(clientSource, /if \(document\.hidden\) return;/, 'deposit monitoring must pause on a hidden tab');
assert.match(clientSource, /POLL_INTERVAL_WITH_REALTIME_MS = 60000/, 'polling must slow down once the realtime stream is open');
assert.match(clientSource, /POLL_INTERVAL_HIDDEN_MS = 120000/, 'hidden tabs must poll far less often');
assert.match(clientSource, /data-private-conversation-list/, 'conversation lists must be addressed without duplicate ids');

const duplicateIds = html => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  return [...new Set(ids.filter(id => ids.filter(other => other === id).length > 1))];
};
assert.deepEqual(duplicateIds(indexHtml), [], 'index.html must not contain duplicate element ids');
assert.deepEqual(duplicateIds(adminHtml), [], 'admin.html must not contain duplicate element ids');

// Dead route registrations: anything added to server.js after createApp() never runs because
// createApp() installs its 404 handler before returning. Legacy code is commented out; strip block
// comments first so only executable registrations are inspected.
const executableServer = serverSource.replace(/\/\*[\s\S]*?\*\//g, '');
assert.doesNotMatch(executableServer, /^app\.(get|post|put|delete|patch)\(/m, 'server.js must not register routes that the app-level 404 swallows');
assert.match(appSource, /app\.get\('\/api\/admin\/health-details', verifyAdmin/, 'the detailed health payload must require an admin session');
assert.doesNotMatch(appSource, /req_app_version/, 'no placeholder helpers may leak into the health handler');

// --- 2. Live HTTP checks ---------------------------------------------------------------------------
process.env.JWT_SECRET = process.env.JWT_SECRET || 'platform-hardening-secret';
const createApp = require('../src/app');
const app = createApp({ resend: null, webpush: null, gameSettings: null });
const server = http.createServer(app);

const request = (port, method, urlPath, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  const finalHeaders = { ...headers };
  if (payload) finalHeaders['Content-Length'] = Buffer.byteLength(payload);
  const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers: finalHeaders }, response => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body: data, headers: response.headers }));
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const health = await request(port, 'GET', '/api/health');
    assert.equal(health.status, 200);
    const healthBody = JSON.parse(health.body);
    assert.equal(typeof healthBody.status, 'string', 'the public probe must still report a status');
    assert.equal(healthBody.deploymentVersion, undefined, 'the public probe must not leak the build id');
    assert.equal(healthBody.financialSchema, undefined, 'the public probe must not leak schema readiness');
    assert.equal(healthBody.migrationMode, undefined, 'the public probe must not leak the runtime mode');

    const details = await request(port, 'GET', '/api/admin/health-details');
    assert.equal(details.status, 401, 'the detailed payload must require an admin session');

    const oversized = await request(port, 'POST', '/api/support', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'x', message: 'y'.repeat(1_500_000) })
    });
    assert.equal(oversized.status, 413, 'bodies above the global limit must be rejected as 413, not 500');

    const malformed = await request(port, 'POST', '/api/support', {
      headers: { 'Content-Type': 'application/json' },
      body: '{"subject":'
    });
    assert.equal(malformed.status, 400, 'malformed JSON must return 400 instead of 500');

    // Session bookkeeping must not consume the credential budget.
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const sessions = await request(port, 'GET', '/api/auth/sessions');
      assert.notEqual(sessions.status, 429, `session listing must stay available (attempt ${attempt + 1})`);
    }

    let limited = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const login = await request(port, 'POST', '/api/auth/login', {
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'someone@example.com', password: 'not-a-real-password' }
      });
      if (login.status === 429) limited += 1;
    }
    assert.ok(limited >= 2, 'credential endpoints must still be rate limited');

    console.log('Platform hardening tests: ok');
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
