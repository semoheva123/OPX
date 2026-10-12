const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const match = client.match(/function buildDemoTickerMessages\(\) \{([\s\S]*?)\n\}/);

assert.ok(match, 'buildDemoTickerMessages must exist');
assert.doesNotMatch(match[0], /المستوى|A1|A2|A3|A4|A5/, 'demo display messages must not include level names');
assert.match(match[0], /إيداع توضيحي بقيمة \$\$\{amount\.toLocaleString\('en-US'\)\} USDT\./, 'deposit message should show only amount');
assert.match(match[0], /سحب توضيحي بقيمة \$\$\{amount\.toLocaleString\('en-US'\)\} USDT\./, 'withdrawal message should show only amount');

console.log('Demo display messages tests passed');
