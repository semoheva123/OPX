// The product UI is themed by two additive stylesheets ("Royal Black": near-black ink
// surfaces, a single polished-gold accent):
//   · styles/operix-royal.css        — the signed-in app shell
//   · styles/operix-royal-guest.css  — the guest experience (landing, auth, product tour)
//
// These guarantees keep those layers honest:
//   1. They are actually loaded, in order, after the premium layer, and cache-busted.
//   2. They define the design tokens the rest of the rules rely on.
//   3. Every rule is scoped to its own surfaces, so the admin console and the static
//      marketing sub-pages never inherit them.
//   4. They target markup that exists — no speculative class names.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const results = [];
const step = (name) => results.push(name);

const layers = [
  { file: 'styles/operix-royal.css', label: 'app' },
  { file: 'styles/operix-royal-guest.css', label: 'guest' },
];
for (const layer of layers) {
  layer.cssPath = path.join(root, layer.file);
  assert.ok(fs.existsSync(layer.cssPath), `${layer.file} must exist`);
  layer.css = fs.readFileSync(layer.cssPath, 'utf8');
}
const css = layers[0].css;

// --- 1. Loaded, ordered, cache-busted -------------------------------------------------------------
const premiumAt = html.indexOf('/styles/operix-premium.css');
const royalAt = html.indexOf('/styles/operix-royal.css');
const guestAt = html.indexOf('/styles/operix-royal-guest.css');
assert.ok(premiumAt > -1, 'the premium layer must stay linked');
assert.ok(royalAt > -1, 'the app layer must be linked from index.html');
assert.ok(guestAt > -1, 'the guest layer must be linked from index.html');
assert.ok(royalAt > premiumAt, 'the app layer must load after the premium layer to win the cascade');
assert.ok(guestAt > royalAt, 'the guest layer must load after the app layer');
assert.match(html.slice(royalAt, royalAt + 120), /operix-royal\.css\?v=[0-9a-z-]+/,
  'the app layer must be cache-busted with a ?v= query, like every other asset');
assert.match(html.slice(guestAt, guestAt + 130), /operix-royal-guest\.css\?v=[0-9a-z-]+/,
  'the guest layer must be cache-busted with a ?v= query');
const inlineEnd = html.lastIndexOf('</style>');
assert.ok(inlineEnd < royalAt, 'the design layers must load after the inline <style> block they override');
step('both layers loaded after premium, in order, cache-busted');

// --- 2. Tokens ------------------------------------------------------------------------------------
for (const token of ['--ink-950', '--ink-850', '--gold-200', '--gold-400', '--gold-500',
  '--line:', '--line-strong', '--text-primary', '--text-muted', '--success', '--danger',
  '--radius-lg', '--shadow-raise', '--shadow-gold']) {
  assert.ok(css.includes(token), `the app design token ${token} must be defined`);
}
const guestCss = layers[1].css;
for (const token of ['--ink-950', '--gold-050', '--gold-300', '--gold-500',
  '--line:', '--line-strong', '--text-primary', '--text-muted', '--shadow-raise', '--shadow-gold']) {
  assert.ok(guestCss.includes(token), `the guest design token ${token} must be defined`);
}
// Both layers draw from the same gold ramp: no second accent may creep back in.
for (const drift of ['#22d3ee', '#67e8f9', '#45d6b0', '#a78bfa', 'rgba(34,211,238', 'rgba(103,232,249']) {
  assert.ok(!guestCss.includes(drift), `the guest layer must not reintroduce a second accent (${drift})`);
}
step('royal design tokens present in both layers');

// --- 3. Scope -------------------------------------------------------------------------------------
const readSelectors = (source) => {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
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
      if (ch === ',' && depth === 0) { found.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    if (current.trim()) found.push(current.trim());
  }
  return found;
};

const scopesByLayer = {
  app: ['#appView', '#appNavBar', '#liveTickerBar', '#authView', 'body:has(#appView)'],
  guest: ['#companyIntroView', '.company-intro', '#authView', '#productTourModal'],
};
const selectors = [];
for (const layer of layers) {
  const found = readSelectors(layer.css);
  assert.ok(found.length > 40, `expected a substantial ${layer.label} layer, found ${found.length} selectors`);
  for (const selector of found) {
    assert.ok(scopesByLayer[layer.label].some((scope) => selector.includes(scope)),
      `"${selector}" escapes the ${layer.label} surfaces — the layer must not leak into other surfaces`);
    selectors.push(selector);
  }
}
for (const layer of layers) {
  for (const forbidden of ['#sidebar', '.admin-shell', 'body.admin-shell', '#adminView']) {
    assert.ok(!layer.css.includes(forbidden),
      `the ${layer.label} design layer must not restyle the admin console (${forbidden})`);
  }
}
step(`all ${selectors.length} selectors in both layers stay on their own surfaces`);

// --- 4. Real markup ------------------------------------------------------------------------------
// Classes that this layer targets must exist in the served shell; anything rendered at runtime is
// accounted for explicitly (state classes toggled by app.js).
const runtimeState = new Set(['is-active', 'social-feed-mode-active']);
const roots = ['#appView', '#appNavBar', '#liveTickerBar', '#authView', '#companyIntroView', '#productTourModal'];
const classRe = /\.([A-Za-z][A-Za-z0-9_-]*)/g;
const idRe = /#([A-Za-z][A-Za-z0-9_-]*)/g;
const checked = new Set();
for (const selector of selectors) {
  let idMatch;
  idRe.lastIndex = 0;
  while ((idMatch = idRe.exec(selector)) !== null) {
    const id = `#${idMatch[1]}`;
    if (roots.includes(id)) continue;
    assert.ok(html.includes(`id="${idMatch[1]}"`), `selector "${selector}" targets missing id ${id}`);
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
