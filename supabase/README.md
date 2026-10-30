# Supabase runtime

This folder contains the canonical Supabase schema and deployment checks for OPERIX.

## Included files
- schema.sql — base SQL schema for users, wallet balances, ledger, transactions, sessions, and security events
- admin-audit-hardening.sql — adds `ip`/`user_agent` to `audit_logs`, the audit indexes, and the service-role-only `admin_audit_logs_page(...)` RPC used by the admin console for server-side filtering and pagination (safe to rerun; the app falls back to bounded in-memory reads when the RPC is absent)
- production-readiness.sql — idempotent upgrade for automated tasks, 6-referral game cycles, one-time A4 milestone rewards, and backend-only RLS
- automatic-withdrawals.sql — persists withdrawal networks and installs the backend-only payout queue/RPCs used for admin-triggered TRC20/BEP20 payouts
- tiered-withdrawal-minimum.sql — allows a $10 minimum for A1/A2 and retains $20 for higher tiers in the atomic withdrawal RPC
- weekly-schedule-guards.sql — blocks Friday task completions only and removes the legacy tier-specific withdrawal weekday guard.
- withdrawals-all-weekdays.sql — removes the legacy withdrawal weekday guard and creates an internal announcement for all existing users that withdrawals are available every day.
- admin-email-broadcasts.sql — installs the durable admin email announcement queue, verified-recipient enforcement, and update opt-out preference
- email-verification-reminders.sql — installs a separate, rate-limited transactional queue for active unverified accounts; links expire after 24 hours
- shared-tron-deposit-txid.sql — installs the idempotent, service-role-only ledger credit for direct platform-wallet TxID deposits
- nowpayments-trc20-deposits.sql, nowpayments-deposit-surcharge.sql, nowpayments-fixed-deposit-fee.sql — historical provider migrations only; do not use for current deposits or delete existing order history
- automatic-trc20-deposits.sql — historical per-user TRON scanner migration; not used by the current shared-wallet TxID flow
- shared-trc20-deposits.sql — historical documentation-only placeholder; do not apply
- migration-plan.md — production rollout and reconciliation rules
- remove-identity-verification.sql — removes legacy identity-verification data and columns from an existing database
- referral-cash-rewards.sql — legacy standalone referral migration; superseded by production-readiness.sql
- daily-evaluation-tasks.sql — deprecated; do not run because it can replace the current task RPC with an older implementation

## Required environment variables
Add these values to the production environment before switching the app:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- TRON_SHARED_DEPOSIT_ADDRESS (the platform-owned USDT TRC20 receiving address)
- TRON_INDEXER_URL / TRON_INDEXER_FALLBACK_URLS (confirmed TRC20 event lookup endpoints)

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
4b. Run tiered-withdrawal-minimum.sql after withdrawal-validation-hardening.sql before deploying the $10 A1/A2 withdrawal minimum.
4a. Run withdrawal-fee-revenue.sql after automatic-withdrawals.sql. It records approved withdrawal fees as idempotent platform-revenue ledger entries only after payout confirmation and backfills fees from existing approved withdrawals.
5. After production-readiness.sql and automatic-withdrawals.sql, run weekly-schedule-guards.sql to preserve the Friday task holiday; this migration also removes the old withdrawal weekday trigger.
5a. Before deploying the all-days withdrawal update, run withdrawals-all-weekdays.sql. It removes any legacy database guard and creates one unread internal notification for each existing user; it is safe to rerun without duplicating that notice. All tiers can then submit withdrawal requests any day, while existing payout review, limits, identity checks, and settlement controls remain unchanged.
6. Run admin-email-broadcasts.sql before deploying admin email announcements. Configure EMAIL_UNSUBSCRIBE_SECRET (a private random value; otherwise JWT_SECRET signs unsubscribe tokens) and a verified EMAIL_FROM. The queue sends only verified regular-user accounts not opted out, in batches of 100.
7. Run email-verification-reminders.sql before deploying the unverified-account reminder panel or worker. It excludes banned/opted-out accounts, deduplicates email addresses, rate-limits reminders to once every 7 days, stores only token hashes, and sends one bounded batch per worker run.
7a. Apply shared-tron-deposit-txid.sql. Set TRON_SHARED_DEPOSIT_ADDRESS to the verified, platform-owned TRON address in encrypted hosting configuration. The app displays its QR and address; users submit a TxID after transferring USDT on TRC20. The server verifies the confirmed token transfer, destination, and amount using a TRON indexer, then credits the user exactly once. No payment intermediary or deposit fee is used. Do not put a wallet private key in hosting or the app; this flow only needs the public receiving address. Keep previous provider tables and transaction/ledger history for reconciliation, but do not use or drop them as part of this change. Existing pending third-party payment orders are not automatically converted; reconcile them with support before decommissioning that account.
8. If verified admin accounts will request withdrawals from the user-facing account UI, run `withdrawal-email-verification-admin-role-fix.sql` after `withdrawal-email-verification.sql`; it permits that email-code request but does not change admin-login TOTP requirements.
8. Run admin-audit-hardening.sql before deploying the current admin console. It records the origin (IP/device) of every admin action and installs the paginated audit RPC, so the console no longer loads up to 10,000 audit rows into application memory.
9. Validate required tables/functions and confirm the application uses only the backend service-role client.
9. Configure the dedicated hot-wallet keys and provider RPCs in hosting secrets, deploy, and run small-value test withdrawals on each enabled network.

## Removing legacy identity-verification data
The application no longer accepts or reviews identity-verification submissions. For an existing project, review and back up the database according to the applicable retention policy, deploy the code changes, then run remove-identity-verification.sql in the Supabase SQL editor. This drops the legacy user columns and removes the corresponding keys from user metadata. It does not delete copies held by external image hosts or in database/storage backups; handle those separately under the applicable retention requirements.

## Enabling referral campaign points
Each directly referred user awards their inviter $1 on the first successful paid activation of the lowest-priced tier, $2 on the second, and $5 on the third. production-readiness.sql installs the idempotent referral ledger and upgrade RPC. This migration does not retroactively reward previously completed tier activations.

## Enabling configurable evaluation tasks
Run production-readiness.sql before deploying the matching application. It adds task entities, assignments, private submissions, and an atomic reward function that validates a same-day community post plus comment or an assigned evaluation with an allowed tag and a 10–500 character note. Evaluation submissions are backend-only. Admins configure each level's task count in the VIP plan editor.

## Legacy SQL files
Do not run daily-evaluation-tasks.sql; it is retained only as a migration-history marker. Do not run the standalone referral-cash-rewards.sql after production-readiness.sql; the current readiness migration already includes that functionality and the A4 milestone award. Do not apply the old NOWPayments or per-user scanner migrations for new deposits. The current supported deposit path is shared platform-wallet USDT TRC20 with user-submitted TxID and on-chain validation.

## Important note
The runtime is intentionally kept Supabase-only to avoid database-layer conflicts and to keep the migration clean.
