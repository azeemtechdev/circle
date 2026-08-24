# DECISIONS.md — architectural decision log

Newest first. Three lines each: **Context** (what forced a choice) / **Decision** (what we chose) / **Consequence** (what it costs or buys us).

---

## 2026-08-24 — ADR-0007: Weekly Supabase keep-alive lives in Phase 0

- **Context:** Supabase's free tier pauses a project after ~1 week of inactivity (PLAN.md §3, gotcha 1), but PLAN.md assigns the keep-alive job to no phase.
- **Decision:** Ship `.github/workflows/supabase-keepalive.yml` in Phase 0, since it directly protects the Phase 0 deliverable "Supabase reachable from a test".
- **Consequence:** A paused database can no longer be a surprise at the start of a session; the cost is one scheduled Action run per week and one extra pair of repository secrets to configure.

## 2026-08-24 — ADR-0006: Line endings normalized to LF in the repository

- **Context:** Development happens on Windows, CI runs on Linux; Git was warning about CRLF conversion on every staged file.
- **Decision:** `.gitattributes` with `* text=auto eol=lf` plus explicit `binary` markers for images and fonts.
- **Consequence:** Diffs stay meaningful across platforms; anyone with pre-existing CRLF working copies may see a one-time renormalization.

## 2026-08-24 — ADR-0005: `noUncheckedIndexedAccess` on top of `strict`

- **Context:** CLAUDE.md mandates TypeScript strict mode and forbids `any` in ledger code; ledger and state-machine code (Phase 1–2) indexes arrays and records constantly, where `strict` alone still hands back a falsely non-nullable value.
- **Decision:** Enable `noUncheckedIndexedAccess` now, while the repository holds ~150 lines.
- **Consequence:** Indexed reads must be narrowed before use — mildly noisier code, but out-of-range access becomes a compile error instead of a runtime `undefined` in a money path. Retrofitting this after Phase 1 would have been expensive.

## 2026-08-24 — ADR-0004: The connection smoke test skips rather than fails when unconfigured

- **Context:** Phase 0 must prove Supabase is reachable from a test, but the repository is cloned and run before any Supabase project exists.
- **Decision:** `readSupabaseEnv()` returns `null` when keys are absent or still hold `.env.example` placeholders, and the smoke suite uses `describe.skipIf` on that; `npm run test:smoke` is the explicit way to run it.
- **Consequence:** A fresh clone has a green test run, so a red suite always means something is actually broken. The risk is a silently skipped test in CI, which is why the phase log lists "repository secrets not set" as an open TODO.

## 2026-08-24 — ADR-0003: Reachability is proven by a deliberate `42P01`

- **Context:** No tables exist until Phase 1, so there is nothing legitimate to query, yet the connection must be proven end to end.
- **Decision:** Query a table that will never exist and assert PostgREST replies with `42P01 undefined_table`.
- **Consequence:** One assertion covers DNS resolution, PostgREST liveness and anon-key acceptance (a rejected key returns 401 instead). The test must be revisited if a table with that name is ever created — the name is prefixed `__circle_connection_smoke_test` to make that essentially impossible.

## 2026-08-24 — ADR-0002: No module-level Supabase client singleton

- **Context:** Vercel serverless functions cold-start and share no memory between requests (PLAN.md §3, gotcha 2); a cached client would encode an assumption the platform does not honour.
- **Decision:** `createSupabaseClient(env)` builds a client per call and takes its configuration as an argument, defaulting to the process environment.
- **Consequence:** Construction cost per request is negligible, tests can inject fake configuration without touching globals, and no request can ever inherit another request's auth state.

## 2026-08-24 — ADR-0001: Next.js App Router + Vitest + Supabase as the Phase 0 skeleton

- **Context:** PLAN.md §3 fixes the $0 stack (Next.js on Vercel, Supabase free tier, GitHub Actions CI) and CLAUDE.md fixes Vitest as the test runner.
- **Decision:** Scaffold with `create-next-app` (App Router, TypeScript, ESLint, Tailwind, `src/`, `@/*` alias) on Next 16 / React 19, add Vitest 4 in a node environment, and add `@supabase/supabase-js` behind a small env-validation module.
- **Consequence:** Frontend and API routes deploy as one Vercel project as planned. Vitest runs in `node` because Phase 0–2 code is pure logic; a browser environment and React Testing Library will need adding when Phase 3 tests components.
