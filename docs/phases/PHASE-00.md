# Phase 00 — Skeleton & guardrails
Status: in progress
Started: 2026-08-24   Completed: —

## Goal
(from PLAN.md §7, Phase 0)

- Next.js app scaffold, Supabase project connected, CI running lint + typecheck + tests
- `docs/phases/` structure created; PLAN.md, ARCHITECTURE.md, CLAUDE.md committed
- **Accept:** deployed "hello" page on Vercel; CI green; Supabase reachable from a test.

## What was built

### 2026-08-24

Scaffold & config
- `package.json` — project renamed to `circle`; scripts `lint`, `typecheck`, `test`, `test:watch`, `test:smoke`, `verify`
- `tsconfig.json` — `strict` plus `noUncheckedIndexedAccess`
- `.gitattributes` — LF in repo, native in working copy (Windows dev, Linux CI)
- `.gitignore` — ignores `.env*` but keeps `.env.example` tracked
- `.env.example` — env template; Supabase keys required now, later phases listed as comments
- `vitest.config.mts` — node environment, tsconfig path alias, 20s timeout for cold starts
- `tests/setup.ts` — loads `.env.local`; real environment variables take precedence over the file

App
- `src/app/page.tsx` — Circle hello page (Phase 0 acceptance artifact)
- `src/app/layout.tsx` — title/description set to Circle

Supabase
- `src/lib/env.ts` — validated env reads; `readSupabaseEnv` (nullable) and `requireSupabaseEnv` (throws with instructions); unedited `your-` placeholders count as unset
- `src/lib/supabase/client.ts` — anon-key client factory, created per call (no module singleton)

Tests
- `src/lib/env.test.ts` — 5 unit tests: present / missing / placeholder / blank / actionable error
- `tests/supabase.smoke.test.ts` — connection smoke test; skips itself until `.env.local` is filled in

CI
- `.github/workflows/ci.yml` — lint + typecheck + tests on every push and PR
- `.github/workflows/supabase-keepalive.yml` — weekly REST ping so the free tier does not pause

Docs
- `docs/phases/PHASE-00.md` (this file), `docs/DECISIONS.md`, `CHANGELOG.md`, `README.md`

## Decisions
(full context in `docs/DECISIONS.md`)

- **Smoke test skips instead of failing when unconfigured** — a fresh clone with no `.env.local` must still have a green test run, otherwise "tests fail" stops meaning "something is broken".
- **Smoke test asserts PostgREST error `42P01` on a table that will never exist** — no schema exists until Phase 1, and this single assertion proves host resolution, PostgREST liveness and anon-key acceptance at once. A bad key returns 401 instead.
- **`noUncheckedIndexedAccess` enabled now, not later** — array and record indexing lands in ledger code in Phase 1; turning this on with ~150 lines in the repo is free, turning it on later is not.
- **No module-level Supabase singleton** — Vercel serverless cold-starts share no memory between requests (PLAN.md §3), so a per-call client keeps that assumption honest.
- **Weekly keep-alive Action built in Phase 0** — PLAN.md §3 names the free-tier pause as a known gotcha but assigns it to no phase. It protects the Phase 0 deliverable ("Supabase reachable"), so it ships here.
- **Dropped `vite-tsconfig-paths`** — Vitest 4 resolves tsconfig paths natively via `resolve.tsconfigPaths`; one fewer dependency.

## How to test

```bash
npm run verify        # lint + typecheck + tests, the same chain CI runs
npm run lint
npm run typecheck
npm test
npm run build         # production build (what Vercel runs)
```

Supabase connection, once `.env.local` holds a real project URL and anon key:

```bash
cp .env.example .env.local     # then edit in the real values
npm run test:smoke
```

Expected before configuring: `2 skipped`. Expected after: `2 passed`.

## Bugs found & fixed

- **Typecheck failed on `src/lib/env.test.ts`** — `TS2345: Property 'NODE_ENV' is missing`. Root cause: the env-reader parameter was typed `NodeJS.ProcessEnv`, which Next augments so that `NODE_ENV` is required, making plain test objects unassignable. Fix: introduced a looser `EnvSource = Readonly<Record<string, string | undefined>>`. Covered by the existing `readSupabaseEnv` tests, which now compile — `npm run typecheck` is the regression guard.
- **Vitest warned that `vitest.config.ts` uses ESM in a CommonJS load path** — renamed to `vitest.config.mts` and removed the redundant `vite-tsconfig-paths` plugin. Test run is now warning-free.

## Known issues / TODOs

- [ ] **Supabase project not created yet** — `.env.local` is unset, so the connection smoke test skips. Phase 0 acceptance criterion "Supabase reachable from a test" is NOT met until the human creates the project and pastes the keys.
- [ ] **Not deployed to Vercel yet** — acceptance criterion "deployed hello page" NOT met. Needs the GitHub repo pushed and the Vercel import done (manual, see README).
- [ ] **CI has never run** — no remote repository exists yet, so "CI green" is unverified. The workflow is committed but unproven.
- [ ] Repository secrets `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be added on GitHub, or the keep-alive Action fails and the smoke test silently skips in CI.
- [ ] No `supabase/migrations/` directory yet — created in Phase 1 with the first schema migration.
- [ ] Tailwind v4 is installed by the scaffold and unused beyond the hello page; the real design pass is Phase 3.
