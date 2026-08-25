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

### 2026-08-25

- `src/lib/env.ts` — URL/key normalization and validation; malformed values now throw with the exact fix instead of returning `null`
- `src/lib/env.test.ts` — 7 new tests covering the REST-path paste, trailing slash, unparseable URL, http vs https, local stack, whitespace trimming, mangled key
- `tests/supabase.smoke.test.ts` — corrected both assertions (`/auth/v1/health` → 200; bogus table → `PGRST205`)
- `.github/workflows/supabase-keepalive.yml` — ping `/auth/v1/health`, since `/rest/v1/` rejects the anon key
- `.env.example`, `README.md` — call out the project-URL-vs-REST-endpoint trap
- `docs/PLAN.md` — Phase 1 TODO: move the keep-alive to a real `SELECT`

## Decisions
(full context in `docs/DECISIONS.md`)

- **Absent config skips, malformed config throws** (2026-08-25, ADR-0009) — a typo'd URL must not masquerade as "not configured yet" and silently skip the smoke test.
- **Reachability asserted via `PGRST205` + `/auth/v1/health`** (2026-08-25, ADR-0008, supersedes ADR-0003) — the original `42P01` / `GET /rest/v1/` assumptions were both wrong; the replacements were checked against the live project first.

- **Smoke test skips instead of failing when unconfigured** — a fresh clone with no `.env.local` must still have a green test run, otherwise "tests fail" stops meaning "something is broken".
- **Smoke test asserts PostgREST error `42P01` on a table that will never exist** — no schema exists until Phase 1, and this single assertion proves host resolution, PostgREST liveness and anon-key acceptance at once. A bad key returns 401 instead.
- **`noUncheckedIndexedAccess` enabled now, not later** — array and record indexing lands in ledger code in Phase 1; turning this on with ~150 lines in the repo is free, turning it on later is not.
- **No module-level Supabase singleton** — Vercel serverless cold-starts share no memory between requests (PLAN.md §3), so a per-call client keeps that assumption honest.
- **Weekly keep-alive Action built in Phase 0** — PLAN.md §3 names the free-tier pause as a known gotcha but assigns it to no phase. It protects the Phase 0 deliverable ("Supabase reachable"), so it ships here.
- **Dropped `vite-tsconfig-paths`** — Vitest 4 resolves tsconfig paths natively via `resolve.tsconfigPaths`; one fewer dependency.

## How to test

```bash
rm -rf .next          # do this first — build residue can hide a CI-only failure
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

As of 2026-08-25 the project is configured, so the full suite reports
`14 passed | 1 skipped` — the one skip is the placeholder that only runs when
Supabase is *un*configured.

## Bugs found & fixed

- **Typecheck failed on `src/lib/env.test.ts`** — `TS2345: Property 'NODE_ENV' is missing`. Root cause: the env-reader parameter was typed `NodeJS.ProcessEnv`, which Next augments so that `NODE_ENV` is required, making plain test objects unassignable. Fix: introduced a looser `EnvSource = Readonly<Record<string, string | undefined>>`. Covered by the existing `readSupabaseEnv` tests, which now compile — `npm run typecheck` is the regression guard.
- **Vitest warned that `vitest.config.ts` uses ESM in a CommonJS load path** — renamed to `vitest.config.mts` and removed the redundant `vite-tsconfig-paths` plugin. Test run is now warning-free.

### 2026-08-25

- **Both smoke tests failed on first real run: `expected false to be true` and `expected 'PGRST125' to be '42P01'`.**
  - *Root cause (two independent faults).* (1) `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` was the REST endpoint `https://…supabase.co/rest/v1/` rather than the project URL. supabase-js appends `/rest/v1` itself, so requests went to `/rest/v1//rest/v1/` and PostgREST answered `PGRST125 Invalid path specified in request URL`. (2) Both assertions in the test were wrong to begin with: `GET /rest/v1/` is service_role-only and returns 401 to an anon key, and PostgREST resolves unknown tables from its schema cache, returning `PGRST205` — not Postgres's `42P01`.
  - *Fix.* Corrected the URL in `.env.local`. Replaced the REST-root probe with `GET /auth/v1/health` (the one liveness endpoint an anon key may call) and changed the expected error code to `PGRST205`. Both replacements were verified against the live project before being written, including that a deliberately bad key returns 401 `Invalid API key` — so the `PGRST205` assertion really does prove key acceptance.
  - *Regression tests.* `src/lib/env.test.ts` — `rejects a URL that already includes the REST path`, plus `strips a trailing slash from the project URL`, `rejects a URL that is not parseable`, `rejects a remote URL served over http`, `accepts a local supabase stack over http`, `trims surrounding whitespace from both values`, `rejects an anon key containing inner whitespace`.
  - *Design change it forced.* `readSupabaseEnv` used to return `null` for anything it disliked, so a typo'd URL would have made the smoke test **skip** and read as "not set up yet". It now returns `null` only for absent/placeholder values and throws — naming the exact edit — for malformed ones. See ADR-0009.

- **CI failed at typecheck once install was fixed:** `src/app/layout.tsx(20,50): error TS2304: Cannot find name 'LayoutProps'.`
  - *Root cause.* `LayoutProps<"/">` is one of Next 16's **generated** route-type globals (`PageProps`, `LayoutProps`, `RouteContext`), emitted into `.next/types/` by `next dev`, `next build` or `next typegen`. `.next/` is gitignored, so CI had no route types. It passed locally only because an earlier `npm run build` had left `.next/` on disk — a false green produced by build residue.
  - *Fix.* `typecheck` is now `next typegen && tsc --noEmit`. `next typegen` generates the route types without a full build, which is exactly this case; confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md`.
  - *Reproduced first.* `rm -rf .next && npm run typecheck` reproduced the CI error verbatim before the fix, and passes after. `npm run verify` was then re-run from a clean tree — the state CI actually starts from.
  - *Lesson recorded.* Any check that depends on generated artefacts must generate them itself, or CI and local disagree. Verify locally with `rm -rf .next` when touching the typecheck path.

- **CI failed at `npm ci` on every push.** Symptom: `npm error code EUSAGE … Missing: @emnapi/runtime@1.11.3 from lock file`, `Missing: @emnapi/core@1.11.3 from lock file`.
  - *Root cause.* `package-lock.json` was written by npm 11.6.2 (Node 24, the dev machine). It records `@tailwindcss/oxide-wasm32-wasi` as depending on `@emnapi/core` and `@emnapi/runtime`, but has no top-level entries for them — only copies nested under `@unrs/resolver-binding-wasm32-wasi` at a different version (1.10.0). npm 11 tolerates that gap; npm 10, which Node 22 bundles and which CI was pinned to, treats it as a lockfile desync and refuses to install.
  - *How it was isolated.* Vercel built the **same commit** successfully, ruling out the platform and the dependency set. `npm ci --dry-run` passes locally, and even `npm ci --dry-run --os=linux --cpu=x64` passes — so the difference had to be the npm version, not Linux. Actions logs are not readable without auth (403 on the API), so the error text came from the human pasting the step output; the public annotations API gave only `Process completed with exit code 1`.
  - *Fix.* Regenerated `package-lock.json` with `npm install --package-lock-only`, which added the eight missing wasm32-wasi entries. The full diff across 513 packages was those eight additions, two nested duplicates removed, and an `electron-to-chromium` patch bump — no real dependency drift. Verified afterwards with a full `npm ci` plus `npm run verify`. Additionally pinned CI to `node-version: 24.x` to match the dev machine, with a workflow comment explaining why it must not be lowered. See ADR-0010.
  - *Regression test.* None possible in Vitest — a lockfile is not application behaviour, and CI itself is the guard. Worth knowing: `npm run verify` locally **cannot** catch this class of bug, because npm 11 considers the incomplete lockfile valid; even `npm ci --dry-run --os=linux --cpu=x64` passes. The tell is that Vercel builds while GitHub Actions does not.
  - *Also fixed in passing.* GitHub annotated the run: `actions/checkout@v4` and `actions/setup-node@v4` target Node 20 and were being forced onto Node 24. Both bumped to `v5`. A `node --version` / `npm --version` step now runs before install so a future failure names its own toolchain.

- **The keep-alive Action would have failed every week.** Symptom: none yet — it had never run. Root cause: it inherited the same wrong assumption, pinging `/rest/v1/` with the anon key and asserting HTTP 200, which that endpoint returns only to `service_role`. Fix: ping `/auth/v1/health` instead. No automated test covers a workflow file; the correction was verified by reproducing the exact request against the live project. A Phase 1 TODO (recorded in PLAN.md) moves this to a real `SELECT`, since a health check may not register as Postgres activity for pause detection.

## Known issues / TODOs

- [x] ~~Supabase project not created~~ — created 2026-08-25, keys in `.env.local`, `npm run test:smoke` passes against the live project. Acceptance criterion "Supabase reachable from a test" **met**.
- [x] ~~Not deployed to Vercel~~ — deployed 2026-08-25 and publicly reachable at <https://circle-ibrahim-azeems-projects.vercel.app> after Deployment Protection was switched off. Verified by fetching the page anonymously: it serves the Circle hello content. Acceptance criterion **met**.
- [ ] **CI not yet green** — `npm ci` failed on both pushes; the lockfile has been repaired and the Node major pinned, but the fix is committed locally and **not pushed**, so it is unproven on the runner. This is the last open Phase 0 gate.
- [x] ~~Repository secrets~~ — added 2026-08-25; the keep-alive Action succeeded on manual dispatch, which confirms both secrets resolve and the `/auth/v1/health` fix works against the live project.
- [ ] Lockfile fragility: npm on Windows can emit a lockfile missing transitive deps of the `wasm32-wasi` optional packages. If `npm ci` ever fails again with `Missing: @emnapi/… from lock file`, regenerate with `npm install --package-lock-only` and diff before committing.
- [ ] `git remote` still points at `circle-.git` (the repo was renamed to `circle`); it works via redirect. Tidy with `git remote set-url origin https://github.com/azeemtechdev/circle.git`.
- [ ] No `supabase/migrations/` directory yet — created in Phase 1 with the first schema migration.
- [ ] Tailwind v4 is installed by the scaffold and unused beyond the hello page; the real design pass is Phase 3.
