# Supabase runtime

This folder contains the canonical Supabase schema and deployment checks for OPERIX.

## Included files
- schema.sql — base SQL schema for users, wallet balances, ledger, transactions, sessions, and security events
- migration-plan.md — production rollout and reconciliation rules
- remove-identity-verification.sql — removes legacy identity-verification data and columns from an existing database
- referral-cash-rewards.sql — adds an idempotent direct-referral cash reward ledger and wallet-credit upgrade RPC

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
1. Create the Supabase project.
2. Run schema.sql in the Supabase SQL editor.
3. Validate the schema with a test insert.
4. Load or reconcile application data into the Supabase tables.
5. Run application checks and approved production validation.

## Removing legacy identity-verification data
The application no longer accepts or reviews identity-verification submissions. For an existing project, review and back up the database according to the applicable retention policy, deploy the code changes, then run remove-identity-verification.sql in the Supabase SQL editor. This drops the legacy user columns and removes the corresponding keys from user metadata. It does not delete copies held by external image hosts or in database/storage backups; handle those separately under the applicable retention requirements.

## Enabling referral campaign points
Each directly referred user awards their inviter $1 on the first successful paid activation of the lowest-priced tier, $2 on the second, and $5 on the third. Rewards are cumulative ($8 if the referral reaches tier three), are credited to the inviter's profit/USDT wallet, and are recorded once per referred user per tier. These fixed rewards replace the previous 10% referral commission. Deploy the application, then run referral-cash-rewards.sql in the Supabase SQL editor to update the database RPC and install the reward ledger before accepting activations. This migration does not retroactively reward previously completed tier activations. Cash prizes and physical prize fulfillment remain manual and must follow published campaign terms.

## Important note
The runtime is intentionally kept Supabase-only to avoid database-layer conflicts and to keep the migration clean.
