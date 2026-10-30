// Retention/cohort analytics, PDF report generation, structured logging and the new security
// headers. Static and live checks: the app is booted on an ephemeral port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const { calculateRetentionCohorts, startOfWeek, weekKey } = require('../src/services/reportService');
const { buildFinancialReportPdf, buildRetentionReportPdf, bidiLine } = require('../src/services/pdfReportService');
const { collectInlineScriptHashes, extractInlineScripts } = require('../src/services/cspHashes');

const results = [];
const step = (name, fn) => { fn(); results.push(name); };

// --- Week bucketing -------------------------------------------------------------------------------
step('weeks start on Monday in UTC', () => {
  assert.equal(startOfWeek('2026-10-28T15:00:00Z').toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(startOfWeek('2026-10-25T23:59:00Z').toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(weekKey('not-a-date'), null);
});

// --- Cohort maths ---------------------------------------------------------------------------------
step('cohorts measure retention per week after signup', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const users = [
    { id: 'u1', createdAt: '2026-10-06T10:00:00Z', lastLoginAt: '2026-10-20T10:00:00Z' },
    { id: 'u2', createdAt: '2026-10-07T10:00:00Z', lastLoginAt: '2026-10-14T10:00:00Z' },
    { id: 'u3', createdAt: '2026-10-08T10:00:00Z', lastLoginAt: null }
  ];
  const transactions = [
    { userId: 'u1', type: 'deposit', status: 'approved', amount: 100, createdAt: '2026-10-13T10:00:00Z' },
    { userId: 'u1', type: 'withdraw', status: 'pending', amount: 20, createdAt: '2026-10-20T10:00:00Z' }
  ];
  const report = calculateRetentionCohorts({ users, transactions, weeks: 4, now });
  assert.equal(report.cohorts.length, 1, 'all three users belong to the same signup week');
  const cohort = report.cohorts[0];
  assert.equal(cohort.cohort, '2026-10-05');
  assert.equal(cohort.size, 3);
  assert.equal(cohort.retention[0].activeUsers, 3, 'signing up counts as week-0 activity');
  assert.equal(cohort.retention[1].activeUsers, 2, 'u1 deposited and u2 logged in during week 1');
  assert.equal(cohort.retention[2].activeUsers, 1, 'only u1 returned in week 2');
  assert.equal(cohort.totalDeposits, 100);
  assert.equal(cohort.depositsPerUser, 33.33);
  assert.equal(report.totals.cohortUsers, 3);
  assert.equal(report.totals.weeklyActiveUsers, 0, 'nobody was active in the current week');
});

step('retention ignores users that signed up before the reporting window', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const users = [{ id: 'old', createdAt: '2025-01-01T00:00:00Z', lastLoginAt: '2026-10-27T00:00:00Z' }];
  const report = calculateRetentionCohorts({ users, transactions: [], weeks: 4, now });
  assert.equal(report.cohorts.length, 0);
  assert.equal(report.totals.cohortUsers, 0);
});

// --- Arabic PDF rendering -------------------------------------------------------------------------
step('Arabic lines are shaped and reversed for PDFKit', () => {
  const line = bidiLine('صافي التدفق النقدي 1034.50 USDT');
  assert.ok(/[\uFE70-\uFEFF]/.test(line), 'Arabic must be converted to presentation forms');
  assert.ok(line.startsWith('1034.50 USDT'), 'a Latin run must stay intact at the left edge of an RTL line');
  assert.ok(line.endsWith('ﺻﺎﻓﻲ'), 'the first logical word must end up on the right');
});

step('the financial PDF is a valid document that embeds Arabic text', async () => {
  const accounting = {
    period: { verifiedDepositInflow: 100, confirmedWithdrawalCash: 40, externalNetCashFlow: 60, withdrawalFeeIncome: 4, depositSurchargeIncome: 3, tierRevenueUsdt: 10, rewardCreditsUsdt: 5, estimatedContributionBeforeOperatingCosts: 12, depositCount: 2, paidWithdrawalCount: 1, transactionsInPeriod: 3 },
    obligations: { walletBalances: 50, lockedVaultPrincipal: 0, expectedVaultIncentives: 0, activeStakingPrincipal: 0, expectedStakingIncentives: 0, totalTrackedCustomerObligations: 50 },
    reconciliation: { ledgerEntriesInPeriod: 4, unmatchedFinancialTransactions: 0, unclassifiedRewardTransactions: 0 },
    daily: [{ date: '2026-10-27', deposits: 60, paidWithdrawals: 20, count: 2 }]
  };
  const buffer = await buildFinancialReportPdf({ accounting, days: 30 });
  assert.ok(buffer.length > 5000, 'PDF should contain a page of content');
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const raw = buffer.toString('latin1');
  assert.match(raw, /FontFile2/, 'the Arabic font must be embedded in the PDF');
  assert.match(raw, /DejaVuSans/);
});

step('the retention PDF renders the cohort matrix', async () => {
  const retention = calculateRetentionCohorts({
    users: [{ id: 'u1', createdAt: '2026-10-06T10:00:00Z', lastLoginAt: '2026-10-27T10:00:00Z' }],
    transactions: [],
    weeks: 4,
    now: new Date('2026-10-28T00:00:00Z')
  });
  const buffer = await buildRetentionReportPdf({ retention });
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 3000);
});

// --- CSP hashes -----------------------------------------------------------------------------------
step('every executable inline script has a CSP hash', () => {
  const hashes = collectInlineScriptHashes(root);
  assert.ok(hashes.length >= 8, `expected hashes for every inline script, received ${hashes.length}`);
  hashes.forEach(hash => assert.match(hash, /^'sha256-[A-Za-z0-9+/=]{44}'$/));
  const jsonLd = extractInlineScripts('<script type="application/ld+json">{"a":1}</script>');
  assert.deepEqual(jsonLd, [], 'data blocks are not executable and must not consume a hash');
  const appSource = read('src/app.js');
  assert.match(appSource, /collectInlineScriptHashes\(path\.join\(__dirname, '..'\)\)/);
  assert.match(appSource, /scriptSrc: \[\n\s*"'self'",\n\s*\.\.\.\(inlineScriptHashes\.length \? inlineScriptHashes : \["'unsafe-inline'"\]\)/);
});

// --- Service worker and client bundle -------------------------------------------------------------
step('the service worker caches the shell but never the API', () => {
  const sw = read('sw.js');
  assert.doesNotMatch(sw, /unregister/, 'sw.js must not unregister itself');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)\) return;/, 'API responses must bypass the cache');
  assert.match(sw, /networkFirstNavigation/);
  assert.match(sw, /'push'/);
  assert.match(read('index.html'), /navigator\.serviceWorker\.register\('\/sw\.js'/, 'index.html must register the worker');
  assert.ok(fs.existsSync(path.join(root, 'offline.html')));
});

step('app.js is served minified with a revalidating cache policy', () => {
  const appSource = read('src/app.js');
  assert.match(appSource, /app\.get\('\/app\.js', sendAppScript\)/);
  assert.match(appSource, /if \(currentHash !== manifest\.sourceHash\) return null;/, 'a stale bundle must be ignored');
  assert.ok(fs.existsSync(path.join(root, 'scripts/build-client.js')));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['build:client'], 'node scripts/build-client.js');
  assert.equal(pkg.scripts.postinstall, 'node scripts/build-client.js');
});

step('structured logging replaced console calls in the server entry point', () => {
  const server = read('server.js');
  assert.doesNotMatch(server, /console\.(log|error|warn)\(/, 'server.js must log through src/services/logger');
  assert.match(server, /require\('\.\/src\/services\/logger'\)/);
  const logger = require('../src/services/logger');
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.error, 'function');
  const sanitized = logger.sanitize({ password: 'x', nested: { token: 'y', ok: 1 }, plain: 2 });
  assert.deepEqual(sanitized, { password: '[redacted]', nested: { token: '[redacted]', ok: 1 }, plain: 2 });
});

// --- Live HTTP ------------------------------------------------------------------------------------
process.env.JWT_SECRET = process.env.JWT_SECRET || 'reporting-suite-secret';
const createApp = require('../src/app');
const app = createApp({ resend: null, webpush: null, gameSettings: null });
const server = http.createServer(app);

const request = (port, method, urlPath, { headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, response => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body: data, headers: response.headers }));
  });
  req.on('error', reject);
  req.end();
});

async function live() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const page = await request(port, 'GET', '/');
    const csp = page.headers['content-security-policy'] || '';
    assert.match(csp, /script-src 'self' 'sha256-/, 'script-src must pin inline scripts by hash');
    assert.doesNotMatch(csp.split('script-src')[1].split(';')[0], /'unsafe-inline'/, 'script-src must not fall back to unsafe-inline');
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /upgrade-insecure-requests/);
    assert.equal(page.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.match(page.headers['strict-transport-security'] || '', /max-age=15552000/);
    assert.ok(page.headers['x-request-id'], 'every response must expose a request id');

    const script = await request(port, 'GET', '/app.js');
    assert.equal(script.status, 200);
    assert.match(script.headers['content-type'], /javascript/);
    assert.match(script.headers['cache-control'], /no-cache/);
    assert.ok(script.body.length < read('app.js').length, 'the minified bundle must be smaller than the source');

    const offline = await request(port, 'GET', '/offline.html');
    assert.equal(offline.status, 200);
    assert.match(offline.body, /لا يوجد اتصال بالإنترنت/);

    const worker = await request(port, 'GET', '/sw.js');
    assert.equal(worker.status, 200);
    assert.match(worker.body, /networkFirstNavigation/);

    const pushKey = await request(port, 'GET', '/api/push/public-key');
    assert.equal(pushKey.status, 200);
    const payload = JSON.parse(pushKey.body);
    assert.equal(payload.success, true);
    assert.ok(Object.prototype.hasOwnProperty.call(payload, 'publicKey'));

    const clientErrors = await request(port, 'POST', '/api/client-errors', { headers: { 'Content-Type': 'application/json' } });
    assert.ok([400, 415, 204].includes(clientErrors.status), 'client error intake must answer without crashing');

    for (const route of ['/api/admin/reports/retention', '/api/admin/reports/retention.pdf', '/api/admin/reports/financial.pdf']) {
      const response = await request(port, 'GET', route);
      assert.equal(response.status, 401, `${route} must require an admin session`);
    }
    results.push('live HTTP: security headers, bundle, service worker and report routes');
  } finally {
    server.close();
  }
}

live()
  .then(() => console.log(`Reporting suite: ok (${results.length} checks)`))
  .catch(error => { console.error('Reporting suite failed:', error.message); process.exit(1); });
