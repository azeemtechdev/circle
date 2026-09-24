# CLAUDE.md — Instructions for Claude Code

You are building **Circle**, a digitized rotating-savings (ajo/esusu) app. This file is your standing orders. `PLAN.md` defines WHAT to build and in what order; `ARCHITECTURE.md` defines HOW the system fits together. Read both before writing any code in a new session.

## Session ritual (every session, no exceptions)

1. Read `PLAN.md` §7 to identify the **current phase** (the first phase whose acceptance criteria are not yet met).
2. Read `git log` for the recent history of that phase. It is the project's record — see "Documentation" below.
3. State the plan for this session in 2–4 bullets BEFORE coding. Wait for confirmation only if the plan deviates from PLAN.md.
4. Work ONLY within the current phase. If you discover work belonging to a later phase, add a TODO to that phase's section in PLAN.md — do not build it now.
5. Before ending: run the test suite and report status honestly (including anything broken or unfinished).

## Hard rules — money & data (violating these is never acceptable)

- **Money is integer kobo** (`BIGINT`). No floats anywhere in a money path. No `parseFloat` on amounts. Display formatting happens only at the UI edge.
- **`ledger_entries` is append-only.** Never write an UPDATE or DELETE against it — in code, in migrations, or in ad-hoc SQL. Corrections are reversing entries. The migration must REVOKE update/delete on this table from the app role.
- **Every double-entry post is atomic**: both rows in one DB transaction or neither.
- **Every mutating API route requires an idempotency key.** Same key + same payload → return the original result, do nothing. Write a test proving replay is a no-op for each new mutating route.
- **State changes go through the state machine functions only** (see ARCHITECTURE.md §2). Never set a status column directly from a route handler. Every transition writes an `events` row.
- **LLM calls always have a non-LLM fallback** and always log to `llm_traces` (prompt version, input, output, latency, token cost). A model outage must never break reminders or block a user flow.

## Engineering conventions

- TypeScript **strict** mode; no `any` in ledger/state-machine code.
- Tests: Vitest. Ledger + state machines target ~100% coverage; write the invariant tests FIRST (ledger sums to zero, append-only, idempotent replay, illegal transitions rejected).
- Migrations: every schema change is a numbered SQL migration in `supabase/migrations/`. Never mutate schema manually.
- Keep the diff small: prefer several small commits with clear messages (`phase-2: contribution claim endpoint + idempotency test`) over one giant commit.
- Secrets live in `.env.local` (gitignored) — never hardcode keys, never commit them. Maintain `.env.example` with placeholder values.
- Simple > clever. This codebase must be explainable in a job interview.
- **Free-tier awareness:** weekly keep-alive Action for Supabase; delays between eval cases (LLM rate limits); assume cold starts (no in-memory state between requests).

## Documentation — the commit message IS the documentation

**Phase logs, ADRs and CHANGELOG entries are discontinued** (decided 2026-09-24). Do not write or update `docs/phases/PHASE-XX.md`, `docs/DECISIONS.md` or `CHANGELOG.md` unless explicitly asked. The ritual cost more than it returned: Phases 1–3 shipped without it anyway, which left a gate nobody could pass and three docs contradicting each other.

The existing files stay as a historical record of Phase 0. They are **not** backfilled, and they are stale past Phase 0 — trust `git log` over them.

Because the commit message is now the only record, it carries the weight the phase log used to:

- Explain **why**, not just what. A diff already shows what changed.
- Record any architectural decision and the alternative you rejected.
- Record bugs as symptom → root cause → fix, and name the regression test.
- Note anything deliberately left undone, and why.
- Keep commits small and single-purpose (`phase-2: contribution claim endpoint + idempotency test`). A commit nobody can read is now a fact nobody can recover.

`PLAN.md` and `ARCHITECTURE.md` stay authoritative for WHAT and HOW, and are still worth correcting when they go wrong.

## When something breaks

Follow the debugging map in `ARCHITECTURE.md` §7 (events → ledger → reconciliation → logs). When you find a bug: (1) reproduce it in a failing test FIRST, (2) fix it, (3) record symptom → root cause → fix in the commit message. Never fix a money bug by editing data; fix code and post reversing entries if the ledger was affected.

## Honesty clause

Do not claim something works without running it. If tests fail, say so. If a phase's acceptance criteria aren't met, the phase is not done — regardless of how much code exists. "No mistakes" is achieved by catching mistakes fast, not by pretending they don't happen.

## Repo layout note

`PLAN.md` and `ARCHITECTURE.md` live in `docs/` — read `docs/PLAN.md` and `docs/ARCHITECTURE.md`.

@AGENTS.md

