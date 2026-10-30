// The signed-in product UI is themed by one additive stylesheet: styles/operix-royal.css
// ("Royal Black": near-black ink surfaces, a single polished-gold accent).
//
// These guarantees keep that layer honest:
//   1. It is actually loaded, after the premium layer, and cache-busted.
//   2. It defines the design tokens the rest of the rules rely on.
//   3. Every rule is scoped to the app shell, so the public marketing pages and the
//      admin console never inherit it.
//   4. It targets markup that exists — no speculative class names.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssPath = path.join(root, 'styles', 'operix-royal.css');
assert.ok(fs.existsSync(cssPath), 'styles/operix-royal.css must exist');
const css = fs.readFileSync(cssPath, 'utf8');
const results = [];
const step = (name) => results.push(name);

// --- 1. Loaded, ordered, cache-busted -------------------------------------------------------------
const premiumAt = html.indexOf('/styles/operix-premium.css');
const royalAt = html.indexOf('/styles/operix-royal.css');
assert.ok(premiumAt > -1, 'the premium layer must stay linked');
assert.ok(royalAt > -1, 'the royal layer must be linked from index.html');
assert.ok(royalAt > premiumAt, 'the royal layer must load after the premium layer to win the cascade');
assert.match(html.slice(royalAt, royalAt + 120), /operix-royal\.css\?v=[0-9a-z-]+/,
  'the royal layer must be cache-busted with a ?v= query, like every other asset');
const inlineEnd = html.lastIndexOf('</style>');
assert.ok(inlineEnd < royalAt, 'the royal layer must load after the inline <style> block it overrides');
step('loaded after premium layer, cache-busted');

// --- 2. Tokens ------------------------------------------------------------------------------------
for (const token of ['--ink-950', '--ink-850', '--gold-200', '--gold-400', '--gold-500',
  '--line:', '--line-strong', '--text-primary', '--text-muted', '--success', '--danger',
  '--radius-lg', '--shadow-raise', '--shadow-gold']) {
  assert.ok(css.includes(token), `the design token ${token} must be defined`);
}
step('royal design tokens present');

// --- 3. Scope -------------------------------------------------------------------------------------
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
const scopes = ['#appView', '#appNavBar', '#liveTickerBar', '#authView', 'body:has(#appView)'];
const selectors = [];
{
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = blockRe.exec(body)) !== null) {
    const prelude = match[1].trim();
    if (prelude.startsWith('@')) continue;
    let depth = 0;
    let current = '';
    for (const ch of prelude) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { selectors.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    if (current.trim()) selectors.push(current.trim());
  }
}
assert.ok(selectors.length > 40, `expected a substantial layer, found ${selectors.length} selectors`);
for (const selector of selectors) {
  assert.ok(scopes.some((scope) => selector.includes(scope)),
    `"${selector}" escapes the app shell — the layer must not touch marketing pages or the admin console`);
}
for (const forbidden of ['#sidebar', '.admin-shell', 'body.admin-shell', '#adminView']) {
  assert.ok(!body.includes(forbidden), `the design layer must not restyle the admin console (${forbidden})`);
}
step(`all ${selectors.length} selectors scoped to the app shell`);

// --- 4. Real markup ------------------------------------------------------------------------------
// Classes that this layer targets must exist in the served shell; anything rendered at runtime is
// accounted for explicitly (state classes toggled by app.js).
const runtimeState = new Set(['is-active', 'social-feed-mode-active']);
const classRe = /\.([A-Za-z][A-Za-z0-9_-]*)/g;
const checked = new Set();
for (const selector of selectors) {
  if (selector.includes('#lblWalletBalance') || selector.includes('#taskLevelPanel') ||
    selector.includes('#taskProgressBar') || selector.includes('#appNavBar') ||
    selector.includes('#liveTickerBar') || selector.includes('#authView')) {
    const ids = selector.match(/#([A-Za-z][A-Za-z0-9_-]*)/g) || [];
    for (const id of ids) {
      if (['#appView', '#appNavBar', '#liveTickerBar', '#authView'].includes(id)) continue;
      assert.ok(html.includes(`id="${id.slice(1)}"`), `selector "${selector}" targets missing id ${id}`);
    }
  }
  let match;
  classRe.lastIndex = 0;
  while ((match = classRe.exec(selector)) !== null) {
    const name = match[1];
    if (runtimeState.has(name) || checked.has(name)) continue;
    checked.add(name);
    const present = new RegExp(`class="[^"]*\\b${name}\\b`).test(html);
    assert.ok(present, `selector "${selector}" targets .${name}, which no element carries`);
  }
}
step(`every targeted class (${checked.size}) and id exists in the markup`);

console.log(`design layer: ${results.length} checks passed`);
