# Supabase runtime

This folder contains the canonical Supabase schema and deployment checks for OPERIX.

## Included files
- schema.sql — base SQL schema for users, wallet balances, ledger, transactions, sessions, and security events
- production-readiness.sql — idempotent upgrade for automated tasks, 6-referral game cycles, one-time A4 milestone rewards, and backend-only RLS
- automatic-withdrawals.sql — persists withdrawal networks and installs the backend-only payout queue/RPCs used for admin-triggered TRC20/BEP20 payouts
- weekly-schedule-guards.sql — blocks Friday/Saturday task completions and restricts new withdrawal requests to Friday for A1/A2 or Saturday for higher tiers (Europe/Istanbul)
- admin-email-broadcasts.sql — installs the durable admin email announcement queue, verified-recipient enforcement, and update opt-out preference
- email-verification-reminders.sql — installs a separate, rate-limited transactional queue for active unverified accounts; links expire after 24 hours
- nowpayments-trc20-deposits.sql — records NOWPayments TRC20 payment requests and provides idempotent IPN crediting
- nowpayments-deposit-surcharge.sql — collects an additional 1% from the depositor while crediting only the requested principal
- automatic-trc20-deposits.sql — legacy direct-TRC20 scanner migration; not used by the NOWPayments-only deposit flow
- shared-trc20-deposits.sql — deprecated, documentation-only placeholder; do not apply
- migration-plan.md — production rollout and reconciliation rules
- remove-identity-verification.sql — removes legacy identity-verification data and columns from an existing database
- referral-cash-rewards.sql — legacy standalone referral migration; superseded by production-readiness.sql
- daily-evaluation-tasks.sql — deprecated; do not run because it can replace the current task RPC with an older implementation

## Required environment variables
Add these values to the production environment before switching the app:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET (IPN secret must match the value in NOWPayments Store Settings)
- APP_URL (public HTTPS origin used for the NOWPayments IPN callback)

## Current operating mode

The project is configured for Supabase as the only application database layer.

## Required environment variables
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

## Deployment order
1. Back up/export the existing project and confirm the target environment.
2. For a new database, run schema.sql. For an existing database, do not rerun the full starter schema blindly.
3. Run production-readiness.sql in the Supabase SQL editor; it is transactional and safe to rerun.
4. Run automatic-withdrawals.sql before deploying automatic payout code. Existing un-networked pending withdrawals must not be auto-paid.
4a. Run withdrawal-fee-revenue.sql after automatic-withdrawals.sql. It records approved withdrawal fees as idempotent platform-revenue ledger entries only after payout confirmation and backfills fees from existing approved withdrawals.
5. After production-readiness.sql and automatic-withdrawals.sql, run weekly-schedule-guards.sql before deploying the weekly task/withdrawal schedule. Friday and Saturday are task holidays; A1/A2 may request withdrawal Friday and all higher tiers Saturday (Europe/Istanbul). This restricts new requests only; already accepted payouts continue through the existing settlement queue.
6. Run admin-email-broadcasts.sql before deploying admin email announcements. Configure EMAIL_UNSUBSCRIBE_SECRET (a private random value; otherwise JWT_SECRET signs unsubscribe tokens) and a verified EMAIL_FROM. The queue sends only verified regular-user accounts not opted out, in batches of 100.
7. Run email-verification-reminders.sql before deploying the unverified-account reminder panel or worker. It excludes banned/opted-out accounts, deduplicates email addresses, rate-limits reminders to once every 7 days, stores only token hashes, and sends one bounded batch per worker run.
7a. Apply nowpayments-trc20-deposits.sql and then nowpayments-deposit-surcharge.sql. New payment requests charge the requested deposit plus 1%; the user's wallet receives only the requested deposit amount. Existing orders retain their original charge and wallet credit. Configure NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET to exactly match the NOWPayments Store IPN secret, and an HTTPS APP_URL. NOWPayments is the sole supported deposit path; its signed callback is `https://<APP_URL>/api/wallet/deposit/nowpayments/ipn`. Do not apply automatic-trc20-deposits.sql to new deployments or enable direct TRON deposit flags.
8. If verified admin accounts will request withdrawals from the user-facing account UI, run `withdrawal-email-verification-admin-role-fix.sql` after `withdrawal-email-verification.sql`; it permits that email-code request but does not change admin-login TOTP requirements.
8. Validate required tables/functions and confirm the application uses only the backend service-role client.
9. Configure the dedicated hot-wallet keys and provider RPCs in hosting secrets, deploy, and run small-value test withdrawals on each enabled network.

## Removing legacy identity-verification data
The application no longer accepts or reviews identity-verification submissions. For an existing project, review and back up the database according to the applicable retention policy, deploy the code changes, then run remove-identity-verification.sql in the Supabase SQL editor. This drops the legacy user columns and removes the corresponding keys from user metadata. It does not delete copies held by external image hosts or in database/storage backups; handle those separately under the applicable retention requirements.

## Enabling referral campaign points
Each directly referred user awards their inviter $1 on the first successful paid activation of the lowest-priced tier, $2 on the second, and $5 on the third. production-readiness.sql installs the idempotent referral ledger and upgrade RPC. This migration does not retroactively reward previously completed tier activations.

## Enabling configurable evaluation tasks
Run production-readiness.sql before deploying the matching application. It adds task entities, assignments, private submissions, and an atomic reward function that validates a same-day community post plus comment or an assigned evaluation with an allowed tag and a 10–500 character note. Evaluation submissions are backend-only. Admins configure each level's task count in the VIP plan editor.

## Legacy SQL files
Do not run daily-evaluation-tasks.sql; it is retained only as a migration-history marker. Do not run the standalone referral-cash-rewards.sql after production-readiness.sql; the current readiness migration already includes that functionality and the A4 milestone award. Do not run automatic-trc20-deposits.sql or shared-trc20-deposits.sql in new environments: direct TRON deposits are not supported, and NOWPayments is the sole deposit provider. The former may remain in existing databases for historical compatibility, but the application no longer scans or credits those addresses.

## Important note
The runtime is intentionally kept Supabase-only to avoid database-layer conflicts and to keep the migration clean.
