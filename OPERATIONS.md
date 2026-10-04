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
- Replace the localhost URLs in `sitemap.xml` and `robots.txt` with the real canonical domain before deployment.
- Run a full production smoke test: authentication, wallet flow, withdrawal, rewards, admin operations, and realtime updates.

## Suggested checks

```text
GET /api/health
GET /status.html
GET /sitemap.xml
GET /api/realtime/token
```

The repository includes application-level protections and endpoints, but backups, external monitoring, DNS, TLS, and provider credentials must be configured in the hosting and infrastructure accounts.

## Automatic USDT withdrawals

Automatic transfers are triggered only by an authorized, individual admin approval in the Finance room. Bulk approval deliberately refuses withdrawals. The server transfers the request's `net_amount` to the saved destination on the saved `TRC20` or `BEP20` network. A withdrawal remains pending until the chain transaction is confirmed; only then is it marked approved and a completion email sent.

### Required setup — do this before deploying the payout code

1. Apply `supabase/automatic-withdrawals.sql` to the production Supabase project after the current canonical schema. The withdrawal RPC signature changed to persist network selection; the new table and restricted RPCs are required.
2. Create a dedicated low-balance hot wallet for each network; do not reuse an owner/deposit wallet. Fund each with USDT and the network's native gas asset (TRX for TRC20; BNB for BEP20).
3. Add these secrets directly in the hosting provider's encrypted environment-variable settings (never commit them or paste them in chat):
	- `TRON_WITHDRAWAL_PRIVATE_KEY`
	- `BSC_WITHDRAWAL_PRIVATE_KEY`
	- `BSC_RPC_URL` (BSC mainnet; the signer refuses a chain ID other than 56)
	- `CRON_SECRET` (required by the existing protected cron endpoint)
	- `TRONGRID_API_KEY` (recommended for rate limits)
4. Optional limits/tuning: `WITHDRAWAL_MAX_SINGLE_USDT` (default `5000`), `BSC_WITHDRAWAL_MIN_CONFIRMATIONS` (default `12`), `BSC_WITHDRAWAL_MAX_GAS_PRICE_GWEI` (default `10`), `TRON_WITHDRAWAL_FEE_LIMIT_SUN` (default `100000000`, capped at `1000000000`), `TRON_WITHDRAWAL_MIN_TRX_SUN` (default: at least the full TRON fee limit), and `TRONGRID_SOLIDITY_API_URL`.
5. Deploy, then run a small-value end-to-end test on each enabled network using a destination you control. Verify the Finance room shows the correct network, amount, sender, recipient, payout state, and explorer hash before enabling normal use.

Keep `WITHDRAWAL_PAYOUTS_ENABLED=false` during migration, deployment, and wallet verification. Set it to `true` only after the small-value test succeeds; leaving it unset or false blocks both admin-triggered broadcasts and cron processing.

The Vercel cron `/api/internal/cron/process-withdrawal-payouts` runs every minute and requires a Vercel plan that supports minute-level cron schedules. If the plan does not, configure an equivalent trusted scheduler to call it with `Authorization: Bearer <CRON_SECRET>`.

### Safety and recovery

- No private key is returned to the browser or stored in Supabase. Signed transaction payloads are AES-GCM encrypted and are used only to rebroadcast the **same transaction hash**, never to create a second transfer. Keep each network's private key unchanged until its payout queue is empty, because it is also used to decrypt its pending signed payloads.
- The minute worker reschedules temporary RPC errors and recovers preparation claims older than five minutes to a visible retryable state. It does not mark a payout paid without chain confirmation and does not automatically refund an ambiguous on-chain transaction.
- Pre-broadcast validation failures remain retryable and do not send funds. Confirmed payouts are final. Ambiguous transactions become `manual_review`; do not refund or create another payment until the hash has been checked on the relevant explorer. The system intentionally favors a manual investigation over risking a duplicate transfer.
- Apply the database migration before deploying this application version. Existing pending withdrawal requests created before network persistence have no trustworthy network recorded and cannot be paid automatically; reject/refund them or have the user create a new request after deployment.
- Never use production keys for testing. Monitor the payout status and transaction hash from the Finance room and fund native gas balances before approving requests.
