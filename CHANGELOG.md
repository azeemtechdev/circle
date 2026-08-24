# CHANGELOG

One line per meaningful change, newest first.

---

## Unreleased

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
