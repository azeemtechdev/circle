# CHANGELOG

One line per meaningful change, newest first.

---

## Unreleased

- `phase-0` — **Phase 0 complete**: CI green on `ee03f03`, hello page live on Vercel, Supabase reachable from a test
- `phase-0` — Fix: `typecheck` now runs `next typegen` first — Next 16's generated `LayoutProps` global lives in gitignored `.next/`, so CI failed with TS2304 while local passed on build residue
- `phase-0` — Fix: `npm ci` failed in CI — regenerated `package-lock.json` to include the missing `@emnapi/*` wasm32-wasi entries, and pinned CI to Node 24.x to match the dev machine
- `phase-0` — CI actions bumped to `checkout@v5` / `setup-node@v5` (v4 was deprecated and force-run on Node 24); toolchain versions now printed before install
- `phase-0` — Fix: keep-alive Action pinged `/rest/v1/`, which rejects the anon key with 401; it now pings `/auth/v1/health`
- `phase-0` — Fix: smoke test asserted `42P01` and a 200 from `/rest/v1/`; both were wrong — now `PGRST205` and `/auth/v1/health`
- `phase-0` — Env config validates and normalizes the Supabase URL; malformed values throw with the exact fix instead of silently reading as unconfigured
- `phase-0` — Documentation skeleton: `docs/phases/PHASE-00.md`, `docs/DECISIONS.md`, `CHANGELOG.md`, project `README.md`
- `phase-0` — Weekly Supabase keep-alive GitHub Action so the free tier never pauses
- `phase-0` — CI workflow running lint + typecheck + tests on every push and pull request
- `phase-0` — Supabase anon-key client factory plus a connection smoke test that skips until `.env.local` is configured
- `phase-0` — `.env.example` template; `.gitignore` keeps it tracked while ignoring every real `.env*`
- `phase-0` — Vitest 4 harness (node environment, `@/*` alias, `.env.local` loading) with unit tests for env validation
- `phase-0` — `.gitattributes` normalizing line endings to LF
- `phase-0` — TypeScript `noUncheckedIndexedAccess` enabled alongside `strict`
- `phase-0` — `typecheck`, `test`, `test:watch`, `test:smoke` and `verify` npm scripts
- `phase-0` — Next.js 16 App Router scaffold (TypeScript, ESLint, Tailwind, `src/`) rebranded as Circle with a hello page
