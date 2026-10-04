# Supabase runtime

This folder contains the canonical Supabase schema and deployment checks for OPERIX.

## Included files
- schema.sql — base SQL schema for users, wallet balances, ledger, transactions, sessions, and security events
- production-readiness.sql — idempotent upgrade for automated tasks, 6-referral game cycles, one-time A4 milestone rewards, and backend-only RLS
- automatic-withdrawals.sql — persists withdrawal networks and installs the backend-only payout queue/RPCs used for admin-triggered TRC20/BEP20 payouts
- migration-plan.md — production rollout and reconciliation rules
- remove-identity-verification.sql — removes legacy identity-verification data and columns from an existing database
- referral-cash-rewards.sql — legacy standalone referral migration; superseded by production-readiness.sql
- daily-evaluation-tasks.sql — deprecated; do not run because it can replace the current task RPC with an older implementation

## Required environment variables
Add these values to the production environment before switching the app:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

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
5. Validate required tables/functions and confirm the application uses only the backend service-role client.
6. Configure the dedicated hot-wallet keys and provider RPCs in hosting secrets, deploy, and run small-value test withdrawals on each enabled network.

## Removing legacy identity-verification data
The application no longer accepts or reviews identity-verification submissions. For an existing project, review and back up the database according to the applicable retention policy, deploy the code changes, then run remove-identity-verification.sql in the Supabase SQL editor. This drops the legacy user columns and removes the corresponding keys from user metadata. It does not delete copies held by external image hosts or in database/storage backups; handle those separately under the applicable retention requirements.

## Enabling referral campaign points
Each directly referred user awards their inviter $1 on the first successful paid activation of the lowest-priced tier, $2 on the second, and $5 on the third. production-readiness.sql installs the idempotent referral ledger and upgrade RPC. This migration does not retroactively reward previously completed tier activations.

## Enabling configurable evaluation tasks
Run production-readiness.sql before deploying the matching application. It adds task entities, assignments, private submissions, and an atomic reward function that validates a same-day community post plus comment or an assigned evaluation with an allowed tag and a 10–500 character note. Evaluation submissions are backend-only. Admins configure each level's task count in the VIP plan editor.

## Legacy SQL files
Do not run daily-evaluation-tasks.sql; it is retained only as a migration-history marker. Do not run the standalone referral-cash-rewards.sql after production-readiness.sql; the current readiness migration already includes that functionality and the A4 milestone award.

## Important note
The runtime is intentionally kept Supabase-only to avoid database-layer conflicts and to keep the migration clean.
