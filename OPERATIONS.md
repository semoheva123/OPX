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

## Automatic TRC20 deposits and withdrawals

Deposits are assigned a deterministic, per-user TRON address derived from a public extended key. The server scans confirmed USDT TRC20 transfers and credits the matching account once using an atomic Supabase function. Do not restore the old shared-address/manual-TxHash workflow: it cannot safely attribute a transfer to a user automatically. New withdrawal requests are restricted to TRC20. Admin approval remains the default; optional auto-approval is limited to verified, low-risk requests and is independently disabled by default. All payouts remain pending until the TRON network confirms them.

### Required setup — keep all switches off until validation

1. Apply `supabase/automatic-withdrawals.sql`, then `supabase/automatic-trc20-deposits.sql`, then `supabase/trc20-only-financials.sql` to production Supabase, in that order. The migrations use service-role-only RPCs and must be applied after the canonical schema.
2. Create a NEW dedicated TRON deposit wallet offline. Run `node scripts/create-tron-deposit-xpub.js` on a trusted offline computer and enter its recovery phrase only into that local hidden prompt. Put the resulting **public** extended key in `TRON_DEPOSIT_XPUB`; never place the seed/private keys in Vercel or Supabase. Keep the seed offline for recovery and manual consolidation of the derived deposit addresses.
3. Create a separate, low-balance TRON payout wallet. Fund it with USDT TRC20 and TRX for network fees. Put only its private key in Vercel's encrypted Production variable `TRON_WITHDRAWAL_PRIVATE_KEY`; never paste it in chat or commit it.
4. Configure `TRONGRID_API_URL` (mainnet endpoint), `TRONGRID_API_KEY` (recommended), and `CRON_SECRET`. Keep `TRON_DEPOSIT_AUTOMATION_ENABLED=false`, `WITHDRAWAL_PAYOUTS_ENABLED=false`, and `WITHDRAWAL_AUTO_APPROVAL_ENABLED=false` while applying migrations, deploying, and validating.
5. Deploy the application. Vercel Hobby does not support minute-level schedules, so the repository uses `.github/workflows/financial-queue-workers.yml` to call `/api/internal/cron/process-tron-deposits` and `/api/internal/cron/process-withdrawal-payouts` every five minutes. Add the current Vercel `CRON_SECRET` as a GitHub Actions repository secret named `CRON_SECRET` (Settings → Secrets and variables → Actions). First run the workflow manually with `auth_only=true`; this checks the shared secret without processing either queue. For normal operation, run it without that option and inspect the safe worker summary. The workflow now fails if either processor returns `skipped: true`, so a green scheduled run confirms that both entered their processing path (not that a transfer occurred). Never put the secret in workflow YAML or logs.
6. Test the derived address against the expected offline wallet derivation, send a tiny TRC20 deposit to a test account, and verify one ledger credit after confirmation. Then test a tiny payout to an address you control and verify its explorer hash and final status. Do not enable unattended approvals before these checks.
7. Enable deposit scanning with `TRON_DEPOSIT_AUTOMATION_ENABLED=true`. Only after the payout test passes, enable `WITHDRAWAL_PAYOUTS_ENABLED=true`. To allow unattended approval, additionally set `WITHDRAWAL_AUTO_APPROVAL_ENABLED=true` and `WITHDRAWAL_AUTO_APPROVAL_ADMIN_ID` to an existing finance-admin UUID. Defaults cap automatic payouts at `100` USDT each and `250` USDT per user per day, require low risk (score at most `20`) and a 30-minute delay. Higher-risk/ineligible withdrawals remain for manual review.

### Important custody and recovery notes

- Each user's deposit USDT lands at that user's derived TRON address. This code does **not** sweep funds from those addresses into the payout wallet; keep the deposit seed offline and consolidate through a controlled, separately tested operation. The payout wallet must be funded independently for withdrawals.
- `WITHDRAWAL_PAYOUTS_ENABLED` and `WITHDRAWAL_AUTO_APPROVAL_ENABLED` are separate controls. The former allows broadcasting an already authorized payout; the latter removes the human approval step only for eligible requests.
- The scanner uses confirmed TRONGrid TRC20 transfer records, checks the configured official token contract and recipient address, and relies on unique transaction hashes plus an atomic wallet/ledger RPC to prevent duplicate credit. Monitor cron health, scanner lag, and deposit/payout balances.
- Never reuse owner or user wallets as the payout hot wallet. Keep `TRON_WITHDRAWAL_PRIVATE_KEY` unchanged while any payout queue entries are pending because it also decrypts stored signed payloads used to rebroadcast the same transaction.
- Previous deposits sent to the old shared platform address cannot be attributed automatically by this new monitor. Reconcile them manually; do not credit based only on amount or a user-submitted hash.
- Never delete rows from `tron_deposit_addresses` or transaction/ledger history just to remove the retired shared-address flow; first inventory and reconcile confirmed on-chain activity.

### Safety and recovery

- No private key is returned to the browser or stored in Supabase. Signed transaction payloads are AES-GCM encrypted and are used only to rebroadcast the **same transaction hash**, never to create a second transfer. Keep each network's private key unchanged until its payout queue is empty, because it is also used to decrypt its pending signed payloads.
- The scheduled worker reschedules temporary RPC errors and recovers preparation claims older than five minutes to a visible retryable state. It does not mark a payout paid without chain confirmation and does not automatically refund an ambiguous on-chain transaction. The GitHub Actions schedule is every five minutes and may be delayed by GitHub; monitor its run history and queue age.
- Pre-broadcast validation failures remain retryable and do not send funds. Confirmed payouts are final. Ambiguous transactions become `manual_review`; do not refund or create another payment until the hash has been checked on the relevant explorer. The system intentionally favors a manual investigation over risking a duplicate transfer.
- Apply the database migration before deploying this application version. Existing pending withdrawal requests created before network persistence have no trustworthy network recorded and cannot be paid automatically; reject/refund them or have the user create a new request after deployment.
- Never use production keys for testing. Monitor the payout status and transaction hash from the Finance room and fund native gas balances before approving requests.
