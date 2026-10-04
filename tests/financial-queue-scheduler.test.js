const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const workflow = read('.github/workflows/financial-queue-workers.yml');
const app = read('src/app.js');
const depositWorker = workflow.slice(workflow.indexOf('      - name: Process confirmed TRON deposits'), workflow.indexOf('      - name: Process authorized withdrawal payouts'));
const payoutWorker = workflow.slice(workflow.indexOf('      - name: Process authorized withdrawal payouts'));

assert.ok(vercel.crons.every(job => !['* * * * *', '*/5 * * * *'].includes(job.schedule)),
  'Vercel Hobby must not be assigned unsupported sub-daily cron schedules');
assert.ok(!vercel.crons.some(job => job.path === '/api/internal/cron/process-tron-deposits'));
assert.ok(!vercel.crons.some(job => job.path === '/api/internal/cron/process-withdrawal-payouts'));
assert.match(workflow, /cron:\s*['"]\*\/5 \* \* \* \*['"]/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /push:/);
assert.match(workflow, /paths:\s*\n\s+- '\.github\/workflows\/financial-queue-workers\.yml'/);
assert.match(workflow, /auth_only:/);
assert.match(workflow, /\/api\/internal\/cron\/__auth_probe__/);
assert.match(workflow, /\/api\/internal\/cron\/check-financial-readiness/);
assert.match(workflow, /--retry 3 --retry-delay 8 --retry-all-errors/);
assert.match(workflow, /expected auth-probe HTTP 404/);
assert.match(workflow, /financialSchema\.ready == true/);
assert.match(workflow, /readyForControlledTest/);
assert.match(workflow, /secrets\.CRON_SECRET/);
assert.match(workflow, /Authorization: Bearer \$\{CRON_SECRET\}/);
assert.match(workflow, /\/api\/internal\/cron\/process-tron-deposits/);
assert.match(workflow, /\/api\/internal\/cron\/process-withdrawal-payouts/);
assert.match(workflow, /--output "\$response_file"/);
assert.match(workflow, /concurrency:/);
assert.match(workflow, /--max-time 70/);
assert.match(workflow, /--retry 3 --retry-delay 8 --retry-all-errors/);
assert.doesNotMatch(depositWorker, /--retry-all-errors|--retry\s+\d/);
assert.doesNotMatch(payoutWorker, /--retry-all-errors|--retry\s+\d/);
assert.match(workflow, /steps\.validate\.outputs\.configured == 'true'/);
assert.match(workflow, /steps\.schema\.outcome == 'success'/);
assert.match(workflow, /jq -e '\.success == true and \(\.result\.skipped != true\)/);
assert.match(workflow, /\.result\.payouts\.skipped != true/);
assert.match(app, /process\.env\.VERCEL_GIT_COMMIT_SHA/);
assert.doesNotMatch(app, /socialfi-20260907-2/);

console.log('Financial queue scheduler tests: ok');
