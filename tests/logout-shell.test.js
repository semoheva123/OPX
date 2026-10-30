// Logout must always restore the guest screen.
//
// Regression: `realtimeEventSource` was read without ever being declared. In normal sessions Ably
// carries the realtime stream, so the SSE handle was never assigned an implicit global and the read
// inside stopRealtimeStream() threw a ReferenceError. logout() executed that teardown *before*
// restoring the screen, so the token was removed but the authenticated shell — with its nine
// navigation tabs — stayed visible until the user reloaded the page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const clientSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const results = [];
const step = (name) => results.push(name);

// --- Static guarantees ----------------------------------------------------------------------------
assert.match(clientSource, /^let realtimeEventSource = null;$/m,
  'the SSE handle must be declared, otherwise reading it throws a ReferenceError');
assert.equal((clientSource.match(/\brealtimeEventSource\s*=\s*new EventSource/g) || []).length, 1,
  'the SSE handle must be created in exactly one place');
const logoutBody = clientSource.slice(clientSource.indexOf('async function logout('), clientSource.indexOf('function changeLanguage('));
assert.ok(logoutBody.indexOf('showGuestLanding') < logoutBody.indexOf('await stopRealtimeStream()'),
  'logout must restore the guest screen before tearing the realtime stream down');
assert.match(logoutBody, /try \{\s*await stopRealtimeStream\(\);\s*\} catch \(error\) \{ \}/,
  'a realtime teardown failure must not abort the logout');
assert.match(clientSource, /sessionGeneration \+= 1;/, 'logout must invalidate requests that are still in flight');
assert.match(clientSource, /if \(generationAtStart !== sessionGeneration \|\| !localStorage\.getItem\('token'\)\) return;/,
  'a late profile response must not re-open the app after logout');
step('static: SSE handle declared and logout restores the screen first');

// --- Runtime --------------------------------------------------------------------------------------
// Keep the page's own inline script: it defines showGuestLanding()/showAuthenticatedShell(), which is
// the code path logout() actually takes in the browser. Only the external bundle is stripped because
// it is evaluated explicitly below.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script[^>]*\ssrc=[^>]*><\/script>/gi, '');

// jsdom has no canvas, so the chart helper fails there for reasons unrelated to logout.
const isEnvironmentNoise = message => /Not implemented|canvas|setTransform/i.test(String(message));

function createClient() {
  const pageErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    const message = `${error.message} ${error.detail?.message || ''}`;
    if (!isEnvironmentNoise(message)) pageErrors.push(message);
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://operix.website/', virtualConsole });
  const { window } = dom;
  const requests = [];
  window.fetch = url => {
    requests.push(String(url));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
  };
  window.eval(clientSource);
  return { window, requests, pageErrors };
}

const visible = (window, id) => {
  const element = window.document.getElementById(id);
  return Boolean(element) && !element.classList.contains('hide');
};

(async () => {
  const { window } = createClient();
  window.localStorage.setItem('token', 'session-token');

  // A logged-in shell with the navigation bar on screen, exactly like the reported state.
  window.showAuthenticatedShell();
  assert.equal(visible(window, 'appNavBar'), true, 'the navigation bar starts visible for a signed-in user');

  await window.logout({ notifyServer: false });
  assert.equal(window.localStorage.getItem('token'), null, 'logout must clear the stored token');
  assert.equal(visible(window, 'appNavBar'), false, 'the navigation tabs must disappear immediately after logout');
  assert.equal(visible(window, 'appView'), false, 'the authenticated shell must be hidden after logout');
  assert.equal(visible(window, 'companyIntroView'), true, 'the guest screen must be restored after logout');
  step('runtime: logout hides the nine navigation tabs without a reload');

  // A profile request that was already in flight when the user clicked logout must not resurrect
  // the shell when it finally answers.
  const { window: lateWindow } = createClient();
  let resolveProfile;
  lateWindow.fetch = url => (String(url).includes('/api/user/profile')
    ? new Promise(resolve => { resolveProfile = resolve; })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) }));
  lateWindow.localStorage.setItem('token', 'session-token');
  lateWindow.showAuthenticatedShell();

  const pendingProfile = lateWindow.loadUserProfile();
  await lateWindow.logout({ notifyServer: false });
  assert.equal(visible(lateWindow, 'appNavBar'), false);
  resolveProfile({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ user: { email: 'user@example.com', tierCode: 'A1', wallet: {}, todayCompletedTasks: 0 } })
  });
  await pendingProfile;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(visible(lateWindow, 'appNavBar'), false, 'a late profile response must not re-show the navigation bar');
  assert.equal(visible(lateWindow, 'appView'), false, 'a late profile response must not re-open the app shell');
  step('runtime: a late profile response cannot re-open the shell');

  // The polling loop reads the SSE handle, so the missing declaration also stopped notifications
  // and profile syncing from ever starting on Ably sessions.
  const { window: pollWindow, pageErrors } = createClient();
  pollWindow.localStorage.setItem('token', 'session-token');
  pollWindow.startNotificationPolling();
  assert.ok(pollWindow.__operixPollInterval > 0, 'notification polling must start (the SSE handle is now readable)');
  step('runtime: notification polling starts');

  assert.deepEqual(pageErrors, [], 'logout must not raise page errors');

  // A browser that still holds an older bundle must correct itself instead of showing stale UI.
  // The external bundle was stripped above, so the stale page is rebuilt with the old build id.
  const staleHtml = html.replace('</head>', '<meta name="operix-build" content="newbuild">\n<script src="app.js?v=oldbuild"></script>\n</head>');
  const staleConsole = new VirtualConsole();
  const staleDom = new JSDOM(staleHtml, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://operix.website/', virtualConsole: staleConsole });
  staleDom.window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
  staleDom.window.matchMedia = staleDom.window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  staleDom.window.eval(clientSource);
  assert.equal(staleDom.window.sessionStorage.getItem('operix_build_reload'), 'newbuild',
    'a page running an older bundle must schedule exactly one reload of the current build');
  assert.equal(staleDom.window.__OPERIX_BUILD, 'oldbuild', 'the bundle must expose the build it was loaded as');
  step('runtime: an older cached bundle triggers a single self-heal reload');

  console.log(`Logout shell tests: ok (${results.length} checks)`);
  process.exit(0);
})().catch(error => {
  console.error('Logout shell tests failed:', error.message);
  process.exit(1);
});
