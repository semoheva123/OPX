const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const routes = read('src/routes/adminRoutes.js');
const controller = read('src/controllers/adminController.js');
const adminUi = read('admin.html');

assert.match(routes, /router\.get\('\/financial-readiness'/, 'readiness route missing from admin routes');
assert.match(routes, /router\.get\('\/financial-accounting'/, 'accounting route missing from admin routes');
assert.match(controller, /async function financialReadiness\(req, res\)/, 'financialReadiness controller missing');
assert.match(controller, /async function financialAccounting\(req, res\)/, 'financialAccounting controller missing');
assert.match(adminUi, /financial-readiness|جاهزية التمويل|جاهزية الدفع/, 'finance readiness panel missing from admin UI');
assert.match(adminUi, /id="financialAccountingSummary"/, 'accounting summary container missing from admin UI');
assert.match(adminUi, /مركز المحاسبة والتسوية|لوحة المحاسبة والتسوية/, 'accounting dashboard heading missing from admin UI');
assert.match(adminUi, /التزامات العملاء المتتبعة/, 'accounting obligations section missing from admin UI');
assert.match(adminUi, /سلامة المطابقة/, 'accounting reconciliation section missing from admin UI');
assert.match(adminUi, /financialAccountingDays|financialAccountingPeriod/, 'accounting period selector missing from admin UI');

console.log('Admin financial readiness tests: ok');
