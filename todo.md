# Circle — Handover & TODO

**Status as of 2026-08-25.** Development frozen mid-Phase 3. This document is the
complete handover for whoever (human or AI) picks the project up next.

Read this file first, then `docs/PLAN.md` (what to build, in order),
`docs/ARCHITECTURE.md` (how it fits together), and `CLAUDE.md` (standing rules).
**`docs/PLAN.md` is the source of truth.** If this file and PLAN.md disagree,
PLAN.md wins.

---

## 1. Current state

### What Circle is

A digitised rotating savings group (ajo / esusu). A fixed group of N members
contributes a fixed amount each period; one member takes the whole pot each
round, until everyone has been paid exactly once.

**v1 never touches money.** Bank transfers happen directly between members,
outside the app. Circle is the ledger, the referee and the reminder brain. This
is deliberate — holding funds would put the project in Nigerian licensed-financial-institution
territory. Do not add payment processing without reading `docs/PLAN.md` §10.

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | Next.js 16.3.2, App Router, React 19.2.8 | TypeScript strict |
| Styling | Tailwind v4 | installed by the scaffold, essentially unused so far |
| Database + Auth | Supabase (Postgres) | free tier |
| Tests | Vitest 4 + PGlite 0.5.7 | PGlite is PostgreSQL 18.3 compiled to WASM, in-process |
| CI + cron | GitHub Actions | |
| Hosting | Vercel | |

**Node 24 is required** (it ships npm 11). CI is pinned to `node-version: 24.x`
on purpose — see §2.7.

### Deployed

- Repo: `github.com/azeemtechdev/circle` (the git remote still says `circle-.git`;
  it works via redirect. `git remote set-url origin https://github.com/azeemtechdev/circle.git` to tidy.)
- Live: `https://circle-ibrahim-azeems-projects.vercel.app` — currently just a
  "Phase 0" hello page.
- Supabase project URL and keys live in `.env.local` (gitignored) and in
  Vercel / GitHub secrets. See `.env.example` for the shape.

### Phases complete

| Phase | Scope | State |
|---|---|---|
| **0 — Skeleton & guardrails** | scaffold, CI, docs skeleton, Supabase reachable | **done**, all acceptance criteria met |
| **1 — Ledger core** | double-entry ledger, reconciliation | **done**, all acceptance criteria met |
| **2 — Circle lifecycle** | state machines, idempotency | **done at the database layer**; see caveat below |
| **3 — PWA screens** | auth, routes, UI | **part 1 only** — authorization + RLS. No auth wiring, no routes, no UI |

**Phase 2 caveat.** PLAN.md says "idempotency keys on all mutating **endpoints**".
There are no HTTP endpoints yet — idempotency is enforced one layer down, in the
SQL functions the routes will call. That is not a shortcut; it is the stronger
place for it. But the endpoint-level requirement is still outstanding (§3.3).

### Migrations applied to the live project

All four have been applied via the Supabase SQL Editor.

| File | What it does |
|---|---|
| `0001_ledger_core.sql` | accounts, transfers, ledger_entries, events; `post_double_entry`, `post_reversal`, `reconcile_ledger`, `account_balance_kobo`; append-only enforcement |
| `0002_lock_down_function_grants.sql` | **security fix** — revokes PUBLIC execute (see §2.6) |
| `0003_circle_lifecycle.sql` | circles, memberships, rounds, contributions, idempotency_keys; the eight transition functions |
| `0004_identity_and_authorization.sql` | **security fix** — actor from `auth.uid()`, per-transition authorization, `profiles`, RLS on nine tables |

There is **no migration runner**. Migrations are applied by hand in the Supabase
SQL Editor. The test suite applies them itself, in filename order, from
`supabase/migrations/`.

### Test suite

`128 passed | 1 skipped` across 10 files at freeze. Roughly 90 seconds — PGlite
boots a fresh Postgres per test file.

The 1 skip is intentional: `tests/supabase.smoke.test.ts` has a placeholder that
only runs when Supabase is *un*configured.

---

## 2. Technical context — rules that will break the app if ignored

### 2.1 Money is integer kobo, held as `bigint`

- `amount_kobo BIGINT` in Postgres, `bigint` in TypeScript. **Never `number`** —
  a JS number is an IEEE-754 double.
- **Never `parseFloat` on an amount.** Never introduce a decimal.
- Amounts cross the database boundary **as text**. `src/lib/money.ts` has the
  only conversion (`koboFromText` / `koboToText`), and it rejects anything that
  is not a plain integer rather than coercing it.
- **Why text:** PostgREST serialises `bigint` as a JSON number. A balance above
  2^53 would arrive silently wrong. This bit us once; `account_balance_kobo()`
  returns `text` for exactly this reason.
- `formatKoboAsNaira()` is for display only. Never feed its output back into a
  calculation.

### 2.2 The ledger is append-only, and enforced that way

- `ledger_entries` and `events` **cannot be UPDATEd or DELETEd by anyone**,
  including the database owner. A trigger raises.
- `TRUNCATE` is blocked too, by separate statement-level triggers — row-level
  triggers do not fire on TRUNCATE, and without those guards "append-only" was
  one careless command from false.
- **Corrections are reversing entries, never edits.** Use `post_reversal()`.
- Never "fix" a money bug by editing data. Fix the code, then post reversing
  entries. `docs/ARCHITECTURE.md` §7 is the debugging map.

### 2.3 The money rules live in SQL, not TypeScript

`post_double_entry` and `post_reversal` are plpgsql functions. Both rows of a
pair are written by one statement, so a movement cannot be half-posted.

**This is not stylistic.** supabase-js cannot run multi-statement transactions,
so a SQL function is the only way to honour "every double-entry post is atomic".

The TypeScript services (`src/lib/ledger/ledger.ts`, `src/lib/circles/circles.ts`)
are deliberately thin wrappers. **Never put a money or state rule in TypeScript
that the migration does not also enforce** — it would only be as strong as one
process.

### 2.4 State machines: statuses are never set directly

```
Circle:       draft → inviting → active → completed
                              ↘ cancelled
Round:        open → collecting → settled → closed
                              ↘ disputed → collecting   (Phase 6, not built)
Contribution: pending → claimed → confirmed
                              ↘ disputed                (Phase 6, not built)
```

- **No application role has INSERT, UPDATE or DELETE on `circles`,
  `memberships`, `rounds`, `contributions`, `accounts`, `ledger_entries`,
  `events` or `transfers`.** Not even `service_role`. Writes go exclusively
  through `SECURITY DEFINER` functions.
- Every transition writes an `events` row via `record_transition()`. The audit
  log is the debugging backbone — do not add a transition that skips it.
- An illegal transition raises. Do not "helpfully" relax a guard; add a new
  transition function instead.

The eight callable transitions:

| Function | Who may call it |
|---|---|
| `create_circle(key, name, amount_kobo, period_days, member_target)` | any signed-in user; becomes owner |
| `invite_member(key, circle_id, user_id, payout_position)` | owner only |
| `accept_invite(key, membership_id)` | the invited user only |
| `activate_circle(key, circle_id, start_date)` | owner only |
| `claim_contribution(key, contribution_id)` | the payer only |
| `confirm_contribution(key, contribution_id)` | that round's recipient only |
| `close_round(key, round_id)` | any member of the circle |
| `cancel_circle(key, circle_id, reason)` | owner only |

`open_round()` is **internal** — called by `activate_circle` and `close_round`,
never by a client, and `authenticated` has no execute grant on it.

### 2.5 The actor comes from `auth.uid()`, never from a parameter

Migration 0004 removed the `p_actor_id` parameter from every transition and
**dropped the old signatures**. Do not reintroduce a caller-supplied actor — a
surviving overload would let anyone name themselves as anybody and defeat every
authorization check. There is a test asserting no such overload exists.

`current_actor()` raises if there is no signed-in user.

In tests, "signing in" means setting the JWT claim:

```ts
await actAs(db, userId);   // tests/support/pglite.ts
```

This works because 0004 creates an `auth.uid()` shim **only when the `auth`
schema is absent** (i.e. in PGlite). It never overwrites Supabase's real one.

### 2.6 Grants: `SECURITY DEFINER` inverts where the security boundary lives

This cost two security fixes already. Understand it before adding a function.

- PostgreSQL grants `EXECUTE` on a new function to `PUBLIC` **by default**.
- A `SECURITY DEFINER` function runs with the *definer's* rights, so revoked
  table grants give **no protection at all**.
- Migration 0001 locked down the tables and looked thorough. It wasn't: `anon`,
  holding only the public anon key, could call `post_double_entry` and write
  real entries into the append-only ledger. Fixed in 0002.
- 0002 sets `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
  so this cannot recur by forgetting. **Every new migration should still revoke
  explicitly anyway.**

**Whenever you add a function, add a grant test.** See
`tests/ledger/grants.test.ts` for the pattern — it checks `public` as a grantee,
not just `anon`.

### 2.7 Row Level Security

- Enabled on all nine tables, with **read-only** policies scoping rows to
  circles you actually belong to. Writes have no grant and go through the
  definer functions, which **bypass RLS** — which is precisely why the
  authorization checks inside those functions matter so much.
- **A superuser bypasses RLS.** A test that forgets `set role authenticated`
  will pass while proving nothing. `tests/lifecycle/rls.test.ts` does it
  correctly; copy that pattern.
- **`is_circle_member()` caveat:** it is called **per row** in several policies
  (`circles`, `rounds`, `contributions`, `accounts`, `transfers`,
  `ledger_entries`, `events`). Fine at pilot scale. If a list view ever feels
  slow, this is the first place to look — the fix is a
  `security definer` helper returning the caller's circle ids once, or an index
  on `memberships (user_id, circle_id) where status <> 'left'`. **Do not
  "optimise" it by weakening a policy.**

### 2.8 Idempotency

- Every mutating function takes an idempotency key as its **first** parameter.
- `idempotency_keys` is a single table: `key` (primary key), `operation`,
  `entity_id`. The PK collision is what makes a replay a no-op — the second
  caller is handed the original `entity_id` and nothing is written.
- `entity_id` is filled in only once the work succeeds. A row with a null
  `entity_id` means a request is genuinely in flight, and a concurrent duplicate
  raises `lock_not_available`.
- A blank or whitespace key is rejected.
- **No role has any grant on `idempotency_keys`** — only the definer functions
  touch it. This is intentional; do not grant access to "inspect" it.
- **There is no TTL or cleanup.** The table grows forever. Add a retention job
  before real scale (see §3.7).

### 2.9 Lockfile fragility — this WILL bite you

`npm install` on Windows re-emits a `package-lock.json` that is missing
top-level `@emnapi/core` and `@emnapi/runtime` (transitive deps of the
`wasm32-wasi` optional packages). npm 11 tolerates it; CI does not, and fails
with:

```
npm error Missing: @emnapi/runtime@1.11.3 from lock file
```

This happened **twice**. The guard is `npm run lockfile:check` (`npm ci --dry-run`),
which now runs first in `npm run verify`.

**Recovery recipe** after any `npm install`:

```bash
mkdir /tmp/lockfix && cp package.json /tmp/lockfix/
cd /tmp/lockfix && npm install --package-lock-only
cp package-lock.json <repo>/
npm run lockfile:check
```

Diff before committing: the only changes should be `@emnapi/*` / wasm entries.

### 2.10 Other traps already hit

- **`next typegen` before `tsc`.** `LayoutProps` / `PageProps` / `RouteContext`
  are *generated* into gitignored `.next/types/`. `npm run typecheck` runs
  `next typegen && tsc --noEmit` for this reason. **Verify from a clean tree
  (`rm -rf .next`)** — build residue produced a false green once.
- **`tsconfig` needs `target: ES2022`** for BigInt literals (`10n`), and
  `allowImportingTsExtensions` because `scripts/reconcile.mts` runs under Node
  directly, whose ESM resolver needs explicit extensions.
- **`src/lib/ledger/*` and `src/lib/circles/*` use relative imports with `.ts`
  extensions, not the `@/` alias**, because Node executes them for the
  reconcile script and does not resolve tsconfig path aliases. Do not "tidy"
  these into `@/` imports.
- **No constructor parameter properties** in those modules — Node's strip-only
  TypeScript mode rejects them. Declare fields explicitly.

---

## 3. Remaining work

### 3.1 Apply-and-verify checklist (do this first, before writing code)

- [ ] Confirm all four migrations are applied: in the SQL Editor, run
      `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1;`
      — expect `create_circle`, `invite_member`, `accept_invite`,
      `activate_circle`, `claim_contribution`, `confirm_contribution`,
      `close_round`, `cancel_circle`, `post_double_entry`, `post_reversal`,
      `reconcile_ledger`, `account_balance_kobo`, `current_actor`,
      `is_circle_member`, `is_circle_owner`, plus internal helpers.
- [ ] Confirm no function still takes `p_actor_id`.
- [ ] `npm ci && npm run verify` — expect green, ~90s.
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` as a **GitHub Actions secret** if not
      already present, then run **Actions → Nightly reconciliation → Run
      workflow**. This workflow has **never run** — it is committed but
      unproven. (§3.7)

### 3.2 Phase 3, part 2 — Supabase Auth wiring

Nothing here exists yet.

- [ ] `npm install @supabase/ssr` (then run the §2.9 lockfile recipe).
- [ ] Cookie-bound clients: a browser client and a server client. The existing
      `src/lib/supabase/client.ts` is an **anon-key, session-less** client built
      for the Phase 0 smoke test — it is not an auth client. Add new ones rather
      than bending it.
- [ ] Middleware to refresh the session cookie.
- [ ] Login / signup screens. PLAN.md §3 says email + phone via Supabase Auth.
- [ ] **Create a `profiles` row on signup.** The `profiles` table exists but
      has **no insert path at all** — no function, no grant, no trigger.
      Recommended: an `on auth.users insert` trigger in a new migration, or a
      `create_profile(key, display_name, phone)` definer function. Until this
      exists, no user has a display name.
- [ ] Sign out.

### 3.3 Phase 3, part 3 — API routes

One route per transition. Each **must**:

- [ ] Require an `Idempotency-Key` request header and pass it through as the
      function's first argument. Reject the request if absent.
- [ ] Use the cookie-bound server client so `auth.uid()` is the real caller.
      **Never** use the service-role key in a user-facing route — it bypasses
      RLS and every authorization check.
- [ ] Map Postgres error codes to HTTP: `insufficient_privilege` → 403,
      `check_violation` → 409, `foreign_key_violation` → 404,
      `lock_not_available` → 409 retry.
- [ ] **Have a test proving replay is a no-op** (CLAUDE.md requires one per
      mutating route).

Routes: `create-circle`, `invite-member`, `accept-invite`, `activate-circle`,
`claim-contribution`, `confirm-contribution`, `close-round`, `cancel-circle`.

`src/lib/circles/supabase-port.ts` already wraps every RPC — the routes should
use `CircleService` over it, not call `supabase.rpc` directly.

### 3.4 Phase 3, part 4 — Screens (PLAN.md §7 Phase 3)

Design brief from PLAN.md: **for the least technical relative.** Big buttons,
no jargon, works on a low-end Android over slow 3G.

- [ ] Create circle (name, amount in naira, period, size).
- [ ] Invite members — **see the design gap in §3.5 first.**
- [ ] Circle dashboard: whose turn it is, who has paid, countdown to due date.
- [ ] "I've paid" (claim) and "Received" (confirm) buttons.
- [ ] History view.
- [ ] Format money only at the edge, with `formatKoboAsNaira()`.

**Acceptance:** a non-technical tester completes a fake round without help.

### 3.5 Known design gaps to resolve during Phase 3

These are real gaps, not nitpicks. Decide deliberately.

- [ ] **Invites require an existing user id.** `invite_member` takes
      `p_user_id uuid`, so the invitee must already be an auth user. PLAN.md
      asks for "invite via link/phone". Needs either an invite-token table
      (invite by link, membership created on acceptance) or a phone-lookup step.
      **This blocks the invite screen.**
- [ ] **The owner is not auto-enrolled.** `create_circle` does not create the
      owner's membership; the owner must invite themselves at a payout position.
      Tests do this explicitly. Either make it implicit in `create_circle` or
      make the UI do it — but do not leave it to the user to discover.
- [ ] **`close_round` may be called by any circle member**, not just the
      recipient, so a silent recipient cannot stall the rotation. The payout
      still goes only to the recipient's account. Confirm this is the policy you
      want.
- [ ] **`memberships.user_id` has no FK** to `auth.users`. Add one now that
      identity exists.
- [ ] **A member cannot leave.** The `left` status exists and the unique index
      accounts for it, but no transition sets it.

### 3.6 Phase 4 onwards (see `docs/PLAN.md` §7 for full detail)

- [ ] **Phase 4 — Notifications.** Telegram bot, GitHub Actions cron for
      reminders, `notifications_log` table (does not exist yet).
- [ ] **Phase 5 — AI reminder agent + evals.** Gemini free tier behind a
      **template fallback** — a model outage must never block a user flow. Log
      every call to `llm_traces` (does not exist yet). `evals/` golden set,
      CI-gated.
- [ ] **Phase 6 — Disputes.** `rounds.disputed` and `contributions.disputed`
      are already permitted by the CHECK constraints but **no transition sets
      them** — that is the Phase 6 work. Add `disputes` table + AI summary.
- [ ] **Phase 7 — Trust score v1.** Rules-based, with an AI *explanation*.
- [ ] **Phase 8 — Real pilot + writeup.**

### 3.7 Operational debt

- [ ] **Nightly reconciliation has never run in CI.** `.github/workflows/reconcile.yml`
      is committed; it needs the `SUPABASE_SERVICE_ROLE_KEY` secret and one
      manual dispatch to prove it. `npm run reconcile` **has** been verified
      locally against the live database: 5 checks, all pass.
- [ ] **Keep-alive may not count as database activity.** `supabase-keepalive.yml`
      pings `/auth/v1/health`, which proves the project is up but may not
      register as Postgres activity for pause detection. Switch it to a real
      `SELECT` now that tables exist. (Already recorded as a TODO in `docs/PLAN.md`.)
- [ ] **`idempotency_keys` grows forever.** Add a retention policy.
- [ ] **Smoke test behaviour inside CI is inferred, not observed.** Repository
      secrets demonstrably resolve (the keep-alive run succeeded), so it should
      be running rather than skipping — but Actions logs need auth to read, and
      if it were silently skipping, CI would still be green.
- [ ] Test suite is ~90s and grows with each PGlite file. If it becomes painful,
      share one database per file rather than per test — but **never** share one
      across files that assert global counts.

### 3.8 Documentation debt — significant

Documentation was **explicitly paused** by the project owner partway through
Phase 1 to conserve budget. CLAUDE.md requires per-phase logs; they do not
exist. **This is the largest single piece of unrecorded knowledge.**

- [ ] `docs/phases/PHASE-01.md` exists only as an **untracked stub** and is not
      committed.
- [ ] `docs/phases/PHASE-02.md` and `PHASE-03.md` were never written.
- [ ] `docs/DECISIONS.md` stops at **ADR-0010**. The PHASE-01 stub references
      an **ADR-0011 (PGlite as the test database) that was never written** —
      that reference is currently dangling.
- [ ] Decisions made after ADR-0010 and recorded **only in commit messages**:
      PGlite over Docker; money rules in SQL rather than TypeScript; `bigint`
      over `number`; the SQL-first state machine; actor from `auth.uid()`;
      read-only RLS with writes via definer functions.
- [ ] `CHANGELOG.md` has no Phase 2 or Phase 3 entries.

**`git log` is the real record of Phases 2–3.** The commit messages are
deliberately detailed — symptom, root cause, fix, and reasoning. Read them
before changing anything in `supabase/migrations/`.

---

## 4. Bug history — five bugs found and fixed, all with regression tests

Worth reading; several were subtle and could recur.

1. **`TRUNCATE` bypassed append-only.** Row-level triggers do not fire on
   TRUNCATE. Fixed with statement-level triggers.
2. **`bigint` lost precision over PostgREST.** Serialised as a JSON number.
   Fixed by moving amounts across as text.
3. **`EXECUTE` defaulted to `PUBLIC`** — `anon` could write to the ledger with
   only the public anon key. Fixed in migration 0002. **The most serious one.**
4. **The actor was a caller-supplied parameter and unchecked** — any signed-in
   user could confirm or cancel on anyone's behalf. Fixed in migration 0004.
5. **Lockfile desync recurred** on `npm install`. Guarded by `lockfile:check`.

Bugs 3 and 4 share a root cause worth internalising: **table-level lockdown
reads as thorough while providing zero protection against a `SECURITY DEFINER`
function.** The boundary is the `EXECUTE` grant and the checks inside the
function body.

---

## 5. Commands

| Command | Purpose |
|---|---|
| `npm run dev` | development server |
| `npm run verify` | lockfile + lint + typecheck + tests — the chain CI runs |
| `npm run lockfile:check` | catches the §2.9 desync before pushing |
| `npm test` | full Vitest suite |
| `npm run test:ledger` | ledger + money only |
| `npm run test:smoke` | Supabase connectivity |
| `npm run reconcile` | ledger invariant check against the live database |

Before trusting a green typecheck: `rm -rf .next && npm run verify`.
