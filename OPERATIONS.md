# OPERIX Operations

## Production checklist

- Set `APP_URL` to the real HTTPS domain before enabling email verification links.
- Configure `ALLOWED_ORIGINS` with only the production web origins.
- Keep `JWT_SECRET`, `RESEND_API_KEY`, `ABLY_API_KEY`, `CRON_SECRET`, AI keys, and blockchain provider keys outside source control; rotate any key that appeared in chat or logs.
- Configure the production `EMAIL_FROM` as a verified custom domain such as `OPERIX <noreply@operix.website>` and never use a `resend.dev` address.
- Set up Vercel/hosting environment variables for production, including `ABLY_API_KEY`, `CRON_SECRET`, `JWT_SECRET`, `RESEND_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and provider blockchain credentials.
- Monitor `/api/health`, process uptime, Supabase connectivity, email delivery, AI provider errors, and blockchain provider errors.
- Configure alerts for repeated login failures, withdrawal backlog, failed email delivery, and health-check failures.
- Put the app behind HTTPS and a reverse proxy with rate limiting and secure headers.
- Keep `sitemap.xml` and `robots.txt` on the canonical HTTPS domain (`https://operix.website`).
- Run a full production smoke test: authentication, wallet flow, withdrawal, rewards, admin operations, and realtime updates.

## Suggested checks

```text
GET /api/health
GET /status.html
GET /sitemap.xml
GET /api/realtime/token
```

The repository includes application-level protections and endpoints, but backups, external monitoring, DNS, TLS, and provider credentials must be configured in the hosting and infrastructure accounts.

## Direct TRC20 deposits and withdrawals

Deposits use the platform's own USDT TRC20 receiving wallet. The app displays its address and QR; the user submits the transaction ID (TxID), and the server credits only after checking the confirmed on-chain transfer's token contract and destination. Duplicate TxIDs are rejected idempotently. No payment intermediary, provider key, callback, or deposit fee is involved. Withdrawals use a separate TRON payout wallet and remain independently controlled.

### Withdrawal availability update

Withdrawals are available every day of the week for every tier. Before deploying the matching application code, run `supabase/withdrawals-all-weekdays.sql` in the production Supabase SQL editor. It removes the legacy weekday trigger and adds an internal unread notification for every existing user, without duplicating it on reruns. The daily schedule does not bypass withdrawal minimums, balance/weekly limits, verified-email and pinned-wallet requirements, email-code verification, review, or payout safety controls.

### Required setup — keep all switches off until validation

1. Apply `supabase/automatic-withdrawals.sql`, `supabase/trc20-only-financials.sql`, `supabase/withdrawal-validation-hardening.sql`, and `supabase/shared-tron-deposit-txid.sql` to production Supabase after the canonical schema. The shared-wallet credit RPC is service-role-only and records each verified TxID exactly once. Keep old provider order tables/history intact for audit and reconciliation; this runtime no longer creates provider invoices or processes callbacks.
	Apply `supabase/withdrawal-email-verification.sql` before deploying the email-code withdrawal build. The code is stored only as an HMAC, is bound to the exact amount/address/network/idempotency key, expires after ten minutes, is single-use, allows at most five attempts, and can be reissued only after a 60-second cooldown. User-facing Google Authenticator is not required; admin TOTP remains unchanged.
	If the official/admin account also tests withdrawal from the user-facing account page, apply `supabase/withdrawal-email-verification-admin-role-fix.sql`; it permits verified, unbanned admin accounts to request that withdrawal email code only, while admin sign-in still requires TOTP.
2. Configure `TRON_SHARED_DEPOSIT_ADDRESS` to the verified platform-owned receiving address in encrypted Production variables. Confirm the address is valid for TRON mainnet and receives the intended USDT TRC20 token. Configure `TRON_INDEXER_URL` and fallbacks for confirmed transfer-event lookups. Never configure or expose the wallet's private key in this app.
3. Test a small controlled deposit from a wallet you control. Confirm the displayed QR resolves to the configured address, the user-submitted TxID is checked against a confirmed USDT TRC20 transfer to that address, and exactly one transaction/ledger credit is recorded. Re-submit the same TxID and confirm it is rejected as a duplicate. Never credit based only on a user-supplied amount or unverified hash.
4. Create a separate, low-balance TRON payout wallet. Fund it with USDT TRC20 and TRX for network fees. Put only its private key in Vercel's encrypted Production variable `TRON_WITHDRAWAL_PRIVATE_KEY`; never paste it in chat or commit it.
5. Configure TRON RPC and solidified-confirmation endpoints for payout operations. Use `TRON_RPC_URL` and `TRON_SOLIDITY_API_URL`; the legacy deposit indexer settings are not used. Keep `WITHDRAWAL_PAYOUTS_ENABLED=false` and `WITHDRAWAL_AUTO_APPROVAL_ENABLED=false` while applying migrations, deploying, and validating.
6. Deploy the application. The repository workflow runs read-only auth/schema/wallet preflight checks; deposit verification is synchronous when a user submits a TxID, not a scheduled scan. The preflight reports shared receiving-address readiness, database schema, payout-key validity, RPC connectivity, payout funding, and unresolved payouts using booleans only. Add the current Vercel `CRON_SECRET` as a GitHub Actions repository secret named `CRON_SECRET`. Never put the secret in workflow YAML or logs.
7. Test a tiny payout to an address you control and verify its explorer hash and final status. Only after checks pass, enable `WITHDRAWAL_PAYOUTS_ENABLED=true`. To allow unattended approval, additionally set `WITHDRAWAL_AUTO_APPROVAL_ENABLED=true` and `WITHDRAWAL_AUTO_APPROVAL_ADMIN_ID` to an existing finance-admin UUID. Defaults cap automatic payouts at `100` USDT each and `250` USDT per user per day, require low risk (score at most `20`) and a 30-minute delay. Higher-risk/ineligible withdrawals remain for manual review.

### Important custody and recovery notes

- The receiving wallet must be controlled by the platform; the separate payout wallet must be funded independently for withdrawals. Never assume a user-submitted TxID is valid until the server's chain verification succeeds.
- `WITHDRAWAL_PAYOUTS_ENABLED` and `WITHDRAWAL_AUTO_APPROVAL_ENABLED` are separate controls. The former allows broadcasting an already authorized payout; the latter removes the human approval step only for eligible requests.
- Monitor TRON indexer availability and failed TxID claims alongside the platform transaction and ledger records. A user should not resend funds just because a claim has not yet passed confirmation.
- Never reuse owner or user wallets as the payout hot wallet. Keep `TRON_WITHDRAWAL_PRIVATE_KEY` unchanged while any unresolved payout rows exist because it also decrypts stored signed payloads used to rebroadcast the same transaction; verify there are no `preparing`, `broadcast`, `manual_review`, or failed-with-hash rows before correcting/rotating it.
- Historical direct-TRON deposit records are retained for audit and reconciliation only. Do not use their old addresses or manually credit a user based on amount or a submitted hash.
- Never delete transaction or ledger history while retiring a previous deposit flow; reconcile historical provider and chain records first.

### Safety and recovery

- No private key is returned to the browser or stored in Supabase. Signed transaction payloads are AES-GCM encrypted and are used only to rebroadcast the **same transaction hash**, never to create a second transfer. Keep each network's private key unchanged until its payout queue is empty, because it is also used to decrypt its pending signed payloads.
- The scheduled worker reschedules temporary RPC errors and recovers preparation claims older than five minutes to a visible retryable state. It does not mark a payout paid without chain confirmation and does not automatically refund an ambiguous on-chain transaction. The GitHub Actions schedule is every five minutes and may be delayed by GitHub; monitor its run history and queue age.
- Pre-broadcast validation failures remain retryable and do not send funds. Confirmed payouts are final. Ambiguous transactions become `manual_review`; do not refund or create another payment until the hash has been checked on the relevant explorer. The system intentionally favors a manual investigation over risking a duplicate transfer.
- Apply the database migration before deploying this application version. Existing pending withdrawal requests created before network persistence have no trustworthy network recorded and cannot be paid automatically; reject/refund them or have the user create a new request after deployment.
- Never use production keys for testing. Monitor the payout status and transaction hash from the Finance room and fund native gas balances before approving requests.

## Admin console security model

- Admin authentication is a separate JWT scope plus mandatory TOTP. The session is issued as an `HttpOnly; SameSite=Lax; Secure` cookie (`operix_admin`, 8 hours) and the console never reads or stores the bearer token in web storage.
- `/admin.html` and `/admin` require a live admin session; unauthenticated visitors are redirected to `/admin-login.html`.
- State-changing API requests are rejected with `403` when the `Origin`/`Referer` does not match the request host or `ALLOWED_ORIGINS`. Server-to-server callbacks (no `Origin` header) are unaffected.
- Rate limits: 200 requests / 15 min for end users, 1200 / 15 min for `/api/admin/*`, and a dedicated 10 / 15 min limit on `/api/auth/admin-login`. Admin traffic no longer consumes the end-user budget, which previously locked operators out behind shared NAT.
- Every admin action is written to `audit_logs` with actor, target, metadata, IP and device. Run `supabase/admin-audit-hardening.sql` so those origin columns and the paginated read RPC exist.
- Operators can review and revoke their own admin sessions from «أمان الإدارة», and revoke every other session with one action.
- Balance adjustments require an operator reason and record the wallet values before and after the change.
