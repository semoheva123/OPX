# Supabase runtime

This folder contains the canonical Supabase schema and deployment checks for OPERIX.

## Included files
- schema.sql — base SQL schema for users, wallet balances, ledger, transactions, sessions, and security events
- migration-plan.md — production rollout and reconciliation rules
- remove-identity-verification.sql — removes legacy identity-verification data and columns from an existing database
- referral-campaign-points.sql — adds referral campaign point balances, an award ledger, and one-time level-award logic
- referral-campaign-points-v2.sql — changes prior 2/3/5 awards and future scoring to 1/2/4

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
Each directly referred user awards their inviter 1 point on the first successful paid activation of the lowest-priced tier, 2 on the second, and 4 on the third. Awards are cumulative (7 points if the referral reaches level three), recorded once per referral per level, and only the first three price-ordered tiers qualify. Deploy the code and run referral-campaign-points.sql if this feature has not been installed yet. If the previous 2/3/5 version was already applied, rerun the updated referral-campaign-points.sql to replace the stored RPC, then run referral-campaign-points-v2.sql once to adjust previously awarded rows and inviter totals. Earlier activations with no award row are not backfilled. Cash prizes and physical prize fulfillment remain manual and must follow published campaign terms.

## Important note
The runtime is intentionally kept Supabase-only to avoid database-layer conflicts and to keep the migration clean.
