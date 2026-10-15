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

## NOWPayments deposits and TRC20 withdrawals

NOWPayments is the sole supported deposit provider. The app creates a provider-specific USDT TRC20 payment order and credits the account only after validating the signed NOWPayments IPN. Direct shared-address deposits, user-submitted TxHash claims, and the legacy TRON deposit scanner are disabled. Keep NOWPayments credentials and its IPN secret in encrypted hosting variables. Withdrawals use a separate TRON payout wallet and remain independently controlled.

### Required setup — keep all switches off until validation

1. Apply `supabase/automatic-withdrawals.sql`, `supabase/trc20-only-financials.sql`, `supabase/withdrawal-validation-hardening.sql`, `supabase/nowpayments-trc20-deposits.sql`, `supabase/nowpayments-deposit-surcharge.sql`, and `supabase/nowpayments-fixed-deposit-fee.sql` to production Supabase after the canonical schema. New orders accept whole-USDT principal amounts from 1 through 999,999, charge a fixed 1 USDT fee, and explicitly request the exact whole-USDT total from NOWPayments (for example, a 22 USDT deposit requires exactly 23 USDT); only the deposit principal is credited. Existing orders retain their stored quote. Do not apply the legacy `automatic-trc20-deposits.sql` migration to new environments. The supported RPCs are service-role-only.
	For a database where the NOWPayments deposit and surcharge migrations are already installed, apply only `supabase/nowpayments-fixed-deposit-fee.sql`; do not rerun the legacy surcharge migration because it normalizes uncredited historical orders.
	Apply `supabase/withdrawal-email-verification.sql` before deploying the email-code withdrawal build. The code is stored only as an HMAC, is bound to the exact amount/address/network/idempotency key, expires after ten minutes, is single-use, allows at most five attempts, and can be reissued only after a 60-second cooldown. User-facing Google Authenticator is not required; admin TOTP remains unchanged.
	If the official/admin account also tests withdrawal from the user-facing account page, apply `supabase/withdrawal-email-verification-admin-role-fix.sql`; it permits verified, unbanned admin accounts to request that withdrawal email code only, while admin sign-in still requires TOTP.
2. Configure `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` (exactly matching Store Settings), and the public HTTPS `APP_URL` in encrypted Production variables. Configure the provider callback as `https://<APP_URL>/api/wallet/deposit/nowpayments/ipn` if required by the store.
3. Verify the NOWPayments account is enabled for real payments before requesting a production deposit. Test with a controlled small payment and confirm the signed IPN creates exactly one transaction and financial-ledger credit. Never credit an account manually from a user-supplied TxHash.
4. Create a separate, low-balance TRON payout wallet. Fund it with USDT TRC20 and TRX for network fees. Put only its private key in Vercel's encrypted Production variable `TRON_WITHDRAWAL_PRIVATE_KEY`; never paste it in chat or commit it.
5. Configure TRON RPC and solidified-confirmation endpoints for payout operations. Use `TRON_RPC_URL` and `TRON_SOLIDITY_API_URL`; the legacy deposit indexer settings are not used. Keep `WITHDRAWAL_PAYOUTS_ENABLED=false` and `WITHDRAWAL_AUTO_APPROVAL_ENABLED=false` while applying migrations, deploying, and validating.
6. Deploy the application. The repository workflow runs the read-only auth/schema/wallet preflight and calls the legacy deposit worker only to verify that it remains safely disabled; NOWPayments deposits are credited by signed IPN, not a scheduled scanner. The preflight reports NOWPayments/IPN readiness, database schema, payout-key validity, RPC connectivity, payout funding, and unresolved payouts using booleans only. Add the current Vercel `CRON_SECRET` as a GitHub Actions repository secret named `CRON_SECRET`. Never put the secret in workflow YAML or logs.
7. Test a tiny payout to an address you control and verify its explorer hash and final status. Only after checks pass, enable `WITHDRAWAL_PAYOUTS_ENABLED=true`. To allow unattended approval, additionally set `WITHDRAWAL_AUTO_APPROVAL_ENABLED=true` and `WITHDRAWAL_AUTO_APPROVAL_ADMIN_ID` to an existing finance-admin UUID. Defaults cap automatic payouts at `100` USDT each and `250` USDT per user per day, require low risk (score at most `20`) and a 30-minute delay. Higher-risk/ineligible withdrawals remain for manual review.

### Important custody and recovery notes

- NOWPayments controls its payment addresses and settlement lifecycle; the platform records the order and credits only through its verified IPN. The separate payout wallet must be funded independently for withdrawals.
- `WITHDRAWAL_PAYOUTS_ENABLED` and `WITHDRAWAL_AUTO_APPROVAL_ENABLED` are separate controls. The former allows broadcasting an already authorized payout; the latter removes the human approval step only for eligible requests.
- NOWPayments IPN signatures and payment-order matching are required before crediting; duplicate callback delivery must remain idempotent. Monitor provider payment status and IPN delivery alongside the platform transaction and ledger records.
- Never reuse owner or user wallets as the payout hot wallet. Keep `TRON_WITHDRAWAL_PRIVATE_KEY` unchanged while any unresolved payout rows exist because it also decrypts stored signed payloads used to rebroadcast the same transaction; verify there are no `preparing`, `broadcast`, `manual_review`, or failed-with-hash rows before correcting/rotating it.
- Historical direct-TRON deposit records are retained for audit and reconciliation only. Do not use their old addresses or manually credit a user based on amount or a submitted hash.
- Never delete transaction or ledger history while retiring a previous deposit flow; reconcile historical provider and chain records first.

### Safety and recovery

- No private key is returned to the browser or stored in Supabase. Signed transaction payloads are AES-GCM encrypted and are used only to rebroadcast the **same transaction hash**, never to create a second transfer. Keep each network's private key unchanged until its payout queue is empty, because it is also used to decrypt its pending signed payloads.
- The scheduled worker reschedules temporary RPC errors and recovers preparation claims older than five minutes to a visible retryable state. It does not mark a payout paid without chain confirmation and does not automatically refund an ambiguous on-chain transaction. The GitHub Actions schedule is every five minutes and may be delayed by GitHub; monitor its run history and queue age.
- Pre-broadcast validation failures remain retryable and do not send funds. Confirmed payouts are final. Ambiguous transactions become `manual_review`; do not refund or create another payment until the hash has been checked on the relevant explorer. The system intentionally favors a manual investigation over risking a duplicate transfer.
- Apply the database migration before deploying this application version. Existing pending withdrawal requests created before network persistence have no trustworthy network recorded and cannot be paid automatically; reject/refund them or have the user create a new request after deployment.
- Never use production keys for testing. Monitor the payout status and transaction hash from the Finance room and fund native gas balances before approving requests.
