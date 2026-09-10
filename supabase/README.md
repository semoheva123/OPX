# Supabase migration readiness

This folder contains the initial migration scaffold for moving OPERIX from MongoDB/Mongoose to Supabase.

## Included files
- schema.sql — base SQL schema for users, wallet balances, ledger, transactions, sessions, and security events
- migration-plan.md — sequence for moving the application safely

## Required environment variables
Add these values to the production environment before switching the app:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

## Current operating mode

The project is configured for Supabase as the active database layer. No legacy MongoDB connection is required for the runtime path.

## Required environment variables
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

## Deployment order
1. Create the Supabase project.
2. Run schema.sql in the Supabase SQL editor.
3. Validate the schema with a test insert.
4. Load the application data into the Supabase tables.
5. Run application checks and approved production validation.

## Important note
The runtime is intentionally kept Supabase-only to avoid database-layer conflicts and to keep the migration clean.
