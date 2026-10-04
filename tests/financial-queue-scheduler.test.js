const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const workflow = read('.github/workflows/financial-queue-workers.yml');

assert.ok(vercel.crons.every(job => !['* * * * *', '*/5 * * * *'].includes(job.schedule)),
  'Vercel Hobby must not be assigned unsupported sub-daily cron schedules');
assert.ok(!vercel.crons.some(job => job.path === '/api/internal/cron/process-tron-deposits'));
assert.ok(!vercel.crons.some(job => job.path === '/api/internal/cron/process-withdrawal-payouts'));
assert.match(workflow, /cron:\s*['"]\*\/5 \* \* \* \*['"]/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /secrets\.CRON_SECRET/);
assert.match(workflow, /Authorization: Bearer \$\{CRON_SECRET\}/);
assert.match(workflow, /\/api\/internal\/cron\/process-tron-deposits/);
assert.match(workflow, /\/api\/internal\/cron\/process-withdrawal-payouts/);
assert.match(workflow, /--output \/dev\/null/);
assert.match(workflow, /concurrency:/);

console.log('Financial queue scheduler tests: ok');
