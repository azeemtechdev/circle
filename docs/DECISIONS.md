# DECISIONS.md — architectural decision log

Newest first. Three lines each: **Context** (what forced a choice) / **Decision** (what we chose) / **Consequence** (what it costs or buys us).

---

## 2026-08-25 — ADR-0010: Repair the incomplete lockfile, and align CI's Node with the dev machine

- **Context:** CI failed at `npm ci` on every push with `EUSAGE … Missing: @emnapi/runtime@1.11.3 from lock file`. The committed lockfile listed `@tailwindcss/oxide-wasm32-wasi` as depending on `@emnapi/core` / `@emnapi/runtime` but carried no top-level entries for them — a genuinely incomplete lockfile, produced by npm 11 on Windows. npm 11 tolerates the gap; npm 10, which Node 22 bundles and which CI was pinned to, correctly refuses.
- **Decision:** Regenerate `package-lock.json` (`npm install --package-lock-only`), which adds the eight missing wasm32-wasi entries; the only other change across 513 packages was an `electron-to-chromium` patch bump, so no real dependency drift. Additionally pin CI to `node-version: 24.x` to match the dev machine, because a runner on a different npm major is a difference the test suite cannot see.
- **Consequence:** The lockfile is now valid for npm 10 and npm 11 alike, so the failure cannot recur simply by changing runner versions, and the Node pin removes a whole class of "works locally" divergence. The residual risk is that npm can re-emit an incomplete lockfile after a future dependency change on Windows; the phase log records the symptom so it is recognised in seconds rather than debugged from scratch.

## 2026-08-25 — ADR-0009: Malformed config throws; only absent config is silent

- **Context:** `NEXT_PUBLIC_SUPABASE_URL` was pasted as the REST endpoint (`https://….supabase.co/rest/v1/`). supabase-js appends `/rest/v1` itself, so every request hit `/rest/v1//rest/v1/` and returned `PGRST125 Invalid path specified in request URL` — a message that names nothing the reader controls.
- **Decision:** `readSupabaseEnv` now returns `null` only for absent or placeholder values and **throws** for values that are present but malformed, naming the exact edit ("Remove the trailing `rest/v1`"). It also strips trailing slashes, rejects non-https except localhost (for a future local `supabase start` stack), and rejects an anon key containing inner whitespace.
- **Consequence:** A typo can no longer masquerade as "not configured yet" and silently skip the smoke test. The cost is that config errors now surface as thrown exceptions at module load rather than at first use — which is the point.

## 2026-08-25 — ADR-0008 (supersedes ADR-0003): Reachability is proven by `PGRST205` plus an auth health check

- **Context:** ADR-0003 asserted that querying a non-existent table returns Postgres error `42P01`, and that `GET /rest/v1/` returns 200 for the anon key. Both were wrong when checked against a real project: PostgREST resolves unknown tables from its schema cache and returns **`PGRST205`**, and `/rest/v1/` is **service_role-only**, answering 401 to an anon key.
- **Decision:** The smoke test now asserts `PGRST205` on the bogus-table query and `200` from `GET /auth/v1/health` (the one liveness endpoint an anon key may call). Verified against the live project: a deliberately bad key returns 401 `Invalid API key`, so the `PGRST205` assertion genuinely proves key acceptance.
- **Consequence:** Both assertions are now confirmed by observation rather than assumption. The keep-alive Action had inherited the same bad assumption and would have failed every week; it now pings `/auth/v1/health` too, with a Phase 1 TODO to move to a real `SELECT` for true Postgres activity.

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

## 2026-08-24 — ADR-0003: Reachability is proven by a deliberate `42P01` — **SUPERSEDED by ADR-0008**

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
