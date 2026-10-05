const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const payout = require('../src/services/withdrawalPayoutService');
const adminController = require('../src/controllers/adminController');
const walletControllerModule = require('../src/controllers/walletController');
const dataAccess = require('../src/services/dataAccess');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const migration = read('supabase/automatic-withdrawals.sql');
const hardeningMigration = read('supabase/withdrawal-validation-hardening.sql');
const controller = read('src/controllers/adminController.js');
const walletController = read('src/controllers/walletController.js');
const server = read('server.js');
const adminHtml = read('admin.html');
const queueWorkflow = read('.github/workflows/financial-queue-workers.yml');

assert.equal(payout.parseTokenUnits('20', 6), 20_000_000n);
assert.equal(payout.parseTokenUnits('1.250001', 6), 1_250_001n);
assert.throws(() => payout.parseTokenUnits('1.0000001', 6), /INVALID_PAYOUT_AMOUNT/);
assert.throws(() => payout.parseTokenUnits('-1', 6), /INVALID_PAYOUT_AMOUNT/);
assert.equal(walletControllerModule.calculateHybridWithdrawalFee(20.001).netAmount, 17.001, 'net payout must preserve the database-supported four decimal places');
assert.equal(walletControllerModule.calculateHybridWithdrawalFee('20.1').feeAmount, 3.01, 'fee rounding must match PostgreSQL numeric rounding');
assert.equal(walletControllerModule.sameWithdrawalIntent(
	{ amount: 20.001, feeAmount: 3, netAmount: 17.001, walletAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', network: 'TRC20' },
	{ amount: 20.001, feeAmount: 3, netAmount: 17.001, walletAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', network: 'TRC20' }
), true);
assert.equal(walletControllerModule.sameWithdrawalIntent(
	{ amount: 20, feeAmount: 3, netAmount: 17, walletAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', network: 'TRC20' },
	{ amount: 20, feeAmount: 3, netAmount: 17, walletAddress: 'TNewRecipientAddressWouldNotMatch000000', network: 'TRC20' }
), false, 'an idempotency key must not alias a different destination');
const expiration = 1_000_000;
assert.deepEqual(payout.classifyTronConfirmation({ txHash: 'hash', expiration, now: expiration + 29 * 60 * 1000 }), { state: 'pending' });
assert.deepEqual(payout.classifyTronConfirmation({ txHash: 'hash', expiration, now: expiration + 31 * 60 * 1000 }), { state: 'expired' });
assert.deepEqual(payout.classifyTronConfirmation({ txHash: 'hash', expiration, now: expiration + 60 * 60 * 1000, observedTransaction: { txID: 'hash' } }), { state: 'confirming' }, 'an observed transaction must never be treated as absent merely because it is old');
assert.deepEqual(payout.classifyTronConfirmation({ txHash: 'hash', expiration, now: expiration + 60 * 60 * 1000, info: { id: 'hash' } }), { state: 'confirming' }, 'a receipt with no final result must remain unresolved');
assert.deepEqual(payout.classifyTronConfirmation({ txHash: 'hash', expiration, info: { id: 'hash', receipt: { result: 'SUCCESS' }, blockNumber: 12 } }), { state: 'confirmed', blockNumber: 12 });
assert.deepEqual(payout.classifyTronConfirmation({ txHash: 'hash', expiration, info: { id: 'hash', receipt: { result: 'FAILED' }, blockNumber: 12 } }), { state: 'failed', blockNumber: 12 });
assert.throws(() => payout.classifyTronConfirmation({ txHash: 'expected', expiration, info: { id: 'other', receipt: { result: 'SUCCESS' } } }), /TRON_CONFIRMATION_HASH_MISMATCH/);
const privateKey = 'unit-test-private-key-never-used-for-chain-signing';
const sealed = payout.encryptSignedPayload('BEP20', privateKey, { rawTransaction: '0xabc' });
assert.match(sealed, /^v1\./);
assert.deepEqual(payout.decryptSignedPayload('BEP20', privateKey, sealed), { rawTransaction: '0xabc' });
assert.throws(() => payout.decryptSignedPayload('BEP20', 'wrong-key', sealed));

assert.match(migration, /create table if not exists public\.withdrawal_payouts/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all privileges on table public\.withdrawal_payouts from public, anon, authenticated/i);
assert.match(migration, /for update/i, 'payout claim/rejection must lock the withdrawal row');
assert.match(migration, /p_network text/i, 'new withdrawal requests persist the selected chain');
assert.match(migration, /INVALID_WITHDRAWAL_AMOUNT/i, 'the atomic RPC validates amount, fee, and net together');
assert.match(migration, /normalized_network <> 'TRC20'/i, 'new withdrawal RPC calls must enforce the supported network');
assert.match(migration, /IDEMPOTENCY_KEY_REUSED/i, 'an idempotency key cannot silently alias a different request');
assert.match(migration, /payout_may_have_been_sent/i, 'a broadcast or ambiguous payout cannot be refunded by rejection');
assert.match(migration, /operix_admin_withdrawal_payout_resume_atomic/i, 'manual recovery must resume the already signed transaction only');
assert.match(migration, /recover_stale_preparing_atomic/i, 'a crashed preparation worker must be recovered into a retryable state');
assert.match(migration, /operix_admin_withdrawal_payout_paid_atomic/i);
assert.match(hardeningMigration, /create or replace function public\.operix_withdraw_atomic/i);
assert.match(hardeningMigration, /INVALID_WITHDRAWAL_AMOUNT/i);
assert.match(hardeningMigration, /IDEMPOTENCY_KEY_REUSED/i);
assert.match(hardeningMigration, /grant execute on function public\.operix_withdraw_atomic/i);
assert.match(walletController, /p_network: normalizedNetwork/);
assert.match(walletController, /TronWeb\.isAddress\(normalizedWalletAddress\)/, 'invalid destination addresses are rejected before reserving funds');
assert.match(walletController, /if \(!user\.twoFactorEnabled \|\| !user\.twoFactorSecret\)/, 'all users including feature-exempt accounts require 2FA for withdrawals');
assert.match(walletController, /withdrawalPayoutService\.getMaxPayoutAmount\(\)/, 'withdrawal request and payout use the same hard maximum');
assert.match(controller, /operix_admin_withdrawal_claim_atomic/);
assert.match(controller, /WITHDRAWAL_PAYOUTS_ENABLED/);
assert.match(controller, /operix_admin_withdrawal_record_broadcast_atomic/);
assert.match(controller, /broadcastPreparedPayout/);
assert.match(controller, /processWithdrawalPayoutQueue/);
assert.match(controller, /operix_admin_withdrawal_payout_defer_atomic/);
assert.match(controller, /recoveredStalePreparations/);
assert.match(controller, /action === 'approve' && selected\.some\(item => item\.type === 'withdraw'\)/, 'bulk approval must not be able to dispatch withdrawal transfers');
assert.match(adminHtml, /موافقة وإرسال/);
assert.match(server, /process-withdrawal-payouts/);
assert.match(queueWorkflow, /\/api\/internal\/cron\/process-withdrawal-payouts/);

function responseRecorder() {
	return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

(async () => {
	const originalFindOne = dataAccess.transaction.findOne;
	const originalRpc = dataAccess.callSupabaseRpc;
	const originalPrepare = payout.preparePayout;
	const originalBroadcast = payout.broadcastPreparedPayout;
	const originalPayoutsEnabled = process.env.WITHDRAWAL_PAYOUTS_ENABLED;
	const originalMaxPayout = process.env.WITHDRAWAL_MAX_SINGLE_USDT;
	const originalResponse = responseRecorder();
	const calls = [];
	let currentPayoutStatus = 'preparing';
	try {
		process.env.WITHDRAWAL_MAX_SINGLE_USDT = 'not-a-number';
		assert.throws(() => payout.getMaxPayoutAmount(), /PAYOUT_AMOUNT_LIMIT_CONFIG_INVALID/, 'an invalid cap must fail closed');
		assert.throws(() => payout.parseTokenUnits('10000', 6), /PAYOUT_AMOUNT_LIMIT_CONFIG_INVALID/);
		if (originalMaxPayout === undefined) delete process.env.WITHDRAWAL_MAX_SINGLE_USDT;
		else process.env.WITHDRAWAL_MAX_SINGLE_USDT = originalMaxPayout;
		await assert.rejects(payout.preparePayout({ network: 'BEP20', walletAddress: '0x1111111111111111111111111111111111111111', amount: 20 }), /UNSUPPORTED_WITHDRAWAL_NETWORK/);
		dataAccess.transaction.findOne = async () => ({ id: 'withdraw-1', type: 'withdraw', status: 'pending', network: 'TRC20' });
		dataAccess.callSupabaseRpc = async (name, args) => {
			calls.push(name);
			if (name === 'operix_admin_withdrawal_claim_atomic') return { transaction: { id: 'withdraw-1', network: 'TRC20', walletAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', netAmount: 20 }, payout: { transactionId: 'withdraw-1', status: currentPayoutStatus, network: 'TRC20' } };
			if (name === 'operix_admin_withdrawal_record_broadcast_atomic') { currentPayoutStatus = 'broadcast'; return { transactionId: 'withdraw-1', status: 'broadcast', network: 'TRC20', txHash: args.p_tx_hash, signedPayload: args.p_signed_payload }; }
			if (name === 'operix_admin_withdrawal_payout_retry_atomic') return { transactionId: 'withdraw-1', status: 'broadcast', network: 'TRC20', txHash: '0xhash', signedPayload: 'encrypted' };
			throw new Error(`Unexpected RPC: ${name}`);
		};
		payout.preparePayout = async () => { calls.push('prepare'); return { txHash: '0xhash', senderAddress: '0x2222222222222222222222222222222222222222', encryptedPayload: 'encrypted', payloadExpiresAt: null }; };
		payout.broadcastPreparedPayout = async () => { calls.push('broadcast'); return { accepted: true, txHash: '0xhash' }; };
		process.env.WITHDRAWAL_PAYOUTS_ENABLED = 'false';
		const disabledResponse = responseRecorder();
		await adminController.withdrawalAction({ body: { transactionId: 'withdraw-1', action: 'approve' }, user: { id: 'admin-1' } }, disabledResponse);
		assert.equal(disabledResponse.statusCode, 503);
		assert.deepEqual(calls, [], 'payouts must be blocked without the explicit production activation flag');

		process.env.WITHDRAWAL_PAYOUTS_ENABLED = 'true';
		await adminController.withdrawalAction({ body: { transactionId: 'withdraw-1', action: 'approve' }, user: { id: 'admin-1' } }, originalResponse);
		assert.equal(originalResponse.statusCode, 202);
		assert.equal(originalResponse.body.payout.status, 'broadcast');
		assert.equal(Object.hasOwn(originalResponse.body.payout, 'signedPayload'), false, 'encrypted signer payload must not be returned to the admin browser');
		assert.ok(calls.indexOf('operix_admin_withdrawal_record_broadcast_atomic') < calls.indexOf('broadcast'), 'the tx hash/payload must be persisted before network broadcast');

		calls.length = 0;
		currentPayoutStatus = 'broadcast';
		const duplicateResponse = responseRecorder();
		await adminController.withdrawalAction({ body: { transactionId: 'withdraw-1', action: 'approve' }, user: { id: 'admin-1' } }, duplicateResponse);
		assert.equal(duplicateResponse.statusCode, 202);
		assert.equal(calls.includes('broadcast'), false, 'repeat approval must not broadcast a second transaction');
		console.log('Automatic withdrawal payout tests: ok');
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	} finally {
		dataAccess.transaction.findOne = originalFindOne;
		dataAccess.callSupabaseRpc = originalRpc;
		payout.preparePayout = originalPrepare;
		payout.broadcastPreparedPayout = originalBroadcast;
		if (originalPayoutsEnabled === undefined) delete process.env.WITHDRAWAL_PAYOUTS_ENABLED;
		else process.env.WITHDRAWAL_PAYOUTS_ENABLED = originalPayoutsEnabled;
		if (originalMaxPayout === undefined) delete process.env.WITHDRAWAL_MAX_SINGLE_USDT;
		else process.env.WITHDRAWAL_MAX_SINGLE_USDT = originalMaxPayout;
	}
})();
