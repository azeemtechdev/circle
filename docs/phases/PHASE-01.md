# Phase 01 — Ledger core with fake money
Status: in progress
Started: 2026-08-25   Completed: —

## Goal
(from PLAN.md §7, Phase 1)

- Schema migrations: accounts, ledger_entries, events
- Ledger service: post double-entry, compute balances, reversing entries
- Property tests: ledger always sums to zero; append-only enforced (DB-level: no UPDATE/DELETE grants on ledger_entries)
- Reconciliation job v1 (runs locally + via GitHub Action)
- **Accept:** simulate a full 5-member circle rotation in a test with fake entries; all invariants hold; reconciliation passes.

## What was built

### 2026-08-25

(in progress — see Decisions for the test-database choice made first)

## Decisions
(full context in `docs/DECISIONS.md`)

- **Test database is PGlite, not a Docker Supabase stack** — this machine has neither Docker nor the Supabase CLI, and PLAN.md's $0 constraint makes a heavy local stack unattractive. PGlite 0.5.7 is PostgreSQL 18.3 compiled to wasm32, running in-process. Verified before committing to it: roles, plpgsql, triggers that block UPDATE/DELETE, `REVOKE` + `has_table_privilege`, transaction rollback and exact `BIGINT` all behave. See ADR-0011.
- **The money rules live in SQL, not TypeScript** — `post_double_entry` and `post_reversal` are plpgsql functions, so both rows of a pair are inserted in one statement and cannot be split by a crashing caller. supabase-js cannot run multi-statement transactions, so this is also the only way to honour "every double-entry post is atomic". The TypeScript service is a thin typed wrapper, and the tests exercise the same SQL that production runs.
- **Money is `bigint` in TypeScript, not `number`** — a JS `number` is a double; CLAUDE.md forbids floats in a money path. Amounts cross the DB boundary as `::text` and are parsed with `BigInt()`.

## How to test

```bash
npm test -- ledger          # ledger invariants
npm test                    # full suite
```

## Bugs found & fixed

(none yet this phase)

## Known issues / TODOs

- [ ] Migrations have not yet been applied to the live Supabase project — PGlite proves the SQL is correct, but the remote schema is still empty.
- [ ] `accounts.circle_id` / `membership_id` have no foreign keys yet; `circles` and `memberships` arrive in Phase 2.
