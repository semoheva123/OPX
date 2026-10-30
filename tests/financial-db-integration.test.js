// Deposit / withdrawal integration checks against a real PostgreSQL/Supabase database.
//
// The whole suite runs inside a transaction that is rolled back at the end, so it is safe to point
// at production: no row created here survives. It is skipped (exit 0) when no database URL is set,
// which keeps `npm test` green on machines without database access.
const assert = require('node:assert/strict');

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || '';

if (!connectionString) {
  console.log('Financial DB integration tests: skipped (set SUPABASE_DATABASE_URL or DATABASE_URL to run).');
  process.exit(0);
}

const { Client } = require('pg');

const TRON_ADDRESS = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
const TRON_SENDER = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ';
const HEX_64 = 'a'.repeat(64);

const results = [];
const it = async (name, fn) => {
  await fn();
  results.push(name);
};

async function expectDatabaseError(client, sql, params, expectedMessage) {
  const savepoint = 'sp_' + Math.random().toString(36).slice(2);
  await client.query(`SAVEPOINT ${savepoint}`);
  let error = null;
  try {
    await client.query(sql, params);
  } catch (caught) {
    error = caught;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  assert.ok(error, `expected the database to reject the call with ${expectedMessage}`);
  assert.equal(error.message, expectedMessage);
}

async function main() {
  const client = new Client({ connectionString, ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false } });
  await client.connect();
  const userId = (await client.query('select gen_random_uuid() as id')).rows[0].id;

  await client.query('BEGIN');
  try {
    await client.query(
      'insert into public.users (id, email, password_hash, username) values ($1, $2, $3, $4)',
      [userId, `integration-${userId}@example.invalid`, 'x', `integration-${userId}@example.invalid`]
    );
    await client.query(
      `insert into public.wallet_balances (user_id, balance, deposit_balance, profit_balance, total_deposits, total_withdrawn, usdt_balance)
       values ($1, 500, 0, 500, 0, 0, 500)`,
      [userId]
    );

    await it('credits a shared TRON deposit once and reports the replay as a duplicate', async () => {
      const first = await client.query(
        'select public.operix_shared_tron_deposit_credit_atomic($1, $2, 0, $3, $4, 25.5, now()) as result',
        [userId, HEX_64, TRON_SENDER, TRON_ADDRESS]
      );
      assert.equal(first.rows[0].result.credited, true);
      assert.equal(first.rows[0].result.duplicate, false);

      const replay = await client.query(
        'select public.operix_shared_tron_deposit_credit_atomic($1, $2, 0, $3, $4, 25.5, now()) as result',
        [userId, HEX_64, TRON_SENDER, TRON_ADDRESS]
      );
      assert.equal(replay.rows[0].result.duplicate, true);

      const wallet = await client.query('select deposit_balance from public.wallet_balances where user_id = $1', [userId]);
      assert.equal(Number(wallet.rows[0].deposit_balance), 25.5, 'a replayed tx hash must not be credited twice');

      const ledger = await client.query("select count(*)::int as count from public.financial_ledger where user_id = $1 and type = 'deposit'", [userId]);
      assert.equal(ledger.rows[0].count, 1, 'exactly one deposit ledger entry expected');
    });

    await it('rejects deposit amounts with more than four decimals', async () => {
      await expectDatabaseError(
        client,
        'select public.operix_shared_tron_deposit_credit_atomic($1, $2, 1, $3, $4, 1.12345, now())',
        [userId, 'b'.repeat(64), TRON_SENDER, TRON_ADDRESS],
        'INVALID_SHARED_TRON_DEPOSIT_EVENT'
      );
    });

    await it('rejects a deposit whose destination is not a TRON address', async () => {
      await expectDatabaseError(
        client,
        'select public.operix_shared_tron_deposit_credit_atomic($1, $2, 1, $3, $4, 5, now())',
        [userId, 'c'.repeat(64), TRON_SENDER, 'not-a-tron-address'],
        'INVALID_SHARED_TRON_DEPOSIT_EVENT'
      );
    });

    await it('rejects a withdrawal above the 100 USDT ceiling', async () => {
      await expectDatabaseError(
        client,
        "select public.operix_withdraw_atomic($1, 150, 15, 135, $2, '', 'integration-key-150', 0, 'low', '[]'::jsonb, 'TRC20')",
        [userId, TRON_ADDRESS],
        'INVALID_WITHDRAWAL_AMOUNT'
      );
    });

    await it('reserves a withdrawal and replays the same idempotency key without charging twice', async () => {
      const first = await client.query(
        "select public.operix_withdraw_atomic($1, 20, 2, 18, $2, '', 'integration-key-020', 0, 'low', '[]'::jsonb, 'TRC20') as result",
        [userId, TRON_ADDRESS]
      );
      assert.equal(first.rows[0].result.duplicate, false);
      const afterFirst = await client.query('select profit_balance from public.wallet_balances where user_id = $1', [userId]);
      assert.equal(Number(afterFirst.rows[0].profit_balance), 480);

      const replay = await client.query(
        "select public.operix_withdraw_atomic($1, 20, 2, 18, $2, '', 'integration-key-020', 0, 'low', '[]'::jsonb, 'TRC20') as result",
        [userId, TRON_ADDRESS]
      );
      assert.equal(replay.rows[0].result.duplicate, true);
      const afterReplay = await client.query('select profit_balance from public.wallet_balances where user_id = $1', [userId]);
      assert.equal(Number(afterReplay.rows[0].profit_balance), 480, 'a replayed request must not debit the wallet again');

      const withdrawals = await client.query("select count(*)::int as count from public.transactions where user_id = $1 and type = 'withdraw'", [userId]);
      assert.equal(withdrawals.rows[0].count, 1);
    });

    await it('rejects a withdrawal that exceeds the profit balance', async () => {
      await client.query('update public.wallet_balances set profit_balance = 5 where user_id = $1', [userId]);
      await expectDatabaseError(
        client,
        "select public.operix_withdraw_atomic($1, 20, 2, 18, $2, '', 'integration-key-insufficient', 0, 'low', '[]'::jsonb, 'TRC20')",
        [userId, TRON_ADDRESS],
        'INSUFFICIENT_PROFIT'
      );
    });
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }

  console.log(`Financial DB integration tests: ok (${results.length} scenarios, all rolled back)`);
}

main().catch(error => {
  console.error('Financial DB integration tests failed:', error.message);
  process.exit(1);
});
