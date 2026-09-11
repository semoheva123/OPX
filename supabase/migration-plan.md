# Supabase rollout plan for OPERIX

## 1. Goal
Operate the app on Supabase while keeping the financial logic consistent and preventing balance drift and duplicate transaction issues caused by multiple wallet fields being updated independently.

## 2. Current production-safe baseline
Before deployment, the app must satisfy these invariants:
- wallet.balance = wallet.depositBalance + wallet.profitBalance
- USDT_balance = wallet.balance
- each financial event is written to FinancialLedger
- duplicate deposit/withdraw attempts are blocked by idempotency reference
- admin actions must reconcile balances through the same source of truth

## 3. Schema mapping
- Application users -> Supabase users
- Application transactions -> Supabase transactions
- Financial ledger events -> Supabase financial_ledger
- Wallet state -> Supabase wallet_balances
- Security sessions -> Supabase sessions
- Security events -> Supabase security_events

## 4. Migration approach
1. Create the Supabase project and apply schema.sql.
2. Add row-level security (RLS) rules for authenticated users.
3. Create SQL or app-layer reconciliation functions for wallet logic.
4. Load users with hashed passwords preserved.
5. Load transactions and ledger entries with the same financial semantics.
6. Validate the balance invariants after the load.
7. Keep the runtime wired to Supabase as the only data layer.

## 5. Critical rules for money data
- Never write to wallet.balance, wallet.depositBalance, wallet.profitBalance, USDT_balance, and OPX_balance independently in different code paths.
- Always update through a single reconciliation function.
- Each transaction must have a stable idempotency key.
- Every money change must also append to financial_ledger.

## 6. Recommended migration order
1. Auth tables and users
2. wallet_balances
3. transactions
4. financial_ledger
5. sessions and security_events
6. business tables (vaults, tasks, social operations)

## 7. Risk note
Supabase is a valid production target, but only after the money logic is standardized. Doing the migration first would just move the same bug to a different database layer.
