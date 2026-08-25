# Circle

Savings circles (ajo / esusu) that keep their own books.

Members of a rotating savings group contribute a fixed amount each period and one
member takes the whole pot each round. It runs on trust and a notebook — and it
breaks. Circle is the app that runs the circle: a transparent double-entry ledger,
automated reminders, a trust layer, and AI-assisted dispute resolution.

**v1 never touches money.** Bank transfers happen directly between members,
outside the app. Circle is the ledger, the referee, and the reminder brain.

- **What to build, and in what order:** [docs/PLAN.md](docs/PLAN.md)
- **How the system fits together:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Standing orders for coding sessions:** [CLAUDE.md](CLAUDE.md)
- **Per-phase build logs:** [docs/phases/](docs/phases/)
- **Architectural decisions:** [docs/DECISIONS.md](docs/DECISIONS.md)

Current phase: **Phase 0 — skeleton & guardrails.**

---

## Stack

| Layer | Tool |
|---|---|
| Frontend + API | Next.js 16 (App Router) on Vercel |
| Database + Auth | Supabase (Postgres) |
| Tests | Vitest |
| CI + cron | GitHub Actions |

Every layer is on a free tier. Nothing here costs money to run.

---

## Getting started

```bash
npm install
cp .env.example .env.local     # then paste your Supabase keys in
npm run dev                    # http://localhost:3000
```

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (what Vercel runs) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Full Vitest suite, once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:smoke` | Supabase connection smoke test only |
| `npm run verify` | lint + typecheck + tests — the same chain CI runs |

Before configuring Supabase, `npm test` reports **2 skipped** — that is the
connection smoke test waiting for `.env.local`. After configuring it, the same
tests pass.

---

## One-time manual setup

Three things cannot be done from the command line. Do them in this order.

### 1. Create the Supabase project (free)

1. Go to <https://supabase.com> and sign in with GitHub.
2. **New project**. Organization: your personal one (free plan).
3. Name: `circle`. Region: pick the one closest to you (`eu-west-2` London is the
   nearest to Nigeria on the free tier). Set a database password and **save it in
   a password manager** — Supabase shows it only once.
4. **Create new project**, then wait ~2 minutes for provisioning.
5. Open **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon / public** key (a long token)
6. Paste both into `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key>
   ```
   **The URL is the bare project origin — no path.** The dashboard also shows a
   REST endpoint ending in `/rest/v1/`; that one is wrong here, because
   supabase-js appends `/rest/v1` itself and the doubled path fails every request
   with `PGRST125 Invalid path specified in request URL`. The env loader rejects
   it by name if you paste it anyway.
7. Prove it works:
   ```bash
   npm run test:smoke
   ```
   Expected: **2 passed**. Troubleshooting:
   - `must be the project origin with no path` — you pasted the REST endpoint; drop the `/rest/v1/`.
   - `fetch failed` — the hostname is wrong or the project is still provisioning.
   - `401 Invalid API key`, or `expected 401 to be 200` on the health check — the anon key is wrong or truncated.
   - an error code other than `PGRST205` on the query test — read the message; the connection itself is fine.

> The anon key is safe in a browser — Row Level Security is what protects the
> data. The **service role** key (same page) is not; it never goes in
> `.env.local` without a comment saying why, and never in a `NEXT_PUBLIC_` name.
> `.env.local` is gitignored. Never commit it.

### 2. Create the GitHub repository

1. Go to <https://github.com/new>.
2. Name: `circle`. Visibility: **Public** — this repo is the portfolio.
3. Do **not** initialize with a README, `.gitignore`, or licence; this repo
   already has commits.
4. **Create repository**, then from the project directory:
   ```bash
   git remote add origin https://github.com/<your-username>/circle.git
   git branch -M main
   git push -u origin main
   ```
5. Watch the **Actions** tab — the CI workflow runs on that first push. It should
   go green.
6. Add the Supabase secrets so CI runs the smoke test and the keep-alive job
   works: **Settings → Secrets and variables → Actions → New repository secret**,
   twice:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
7. Verify the keep-alive job: **Actions → Supabase keep-alive → Run workflow**.
   It should print `Supabase responded with HTTP 200`.

### 3. Deploy to Vercel (free)

1. Go to <https://vercel.com> and sign in **with GitHub**.
2. **Add New… → Project**, then **Import** the `circle` repository. Grant Vercel
   access to it if prompted.
3. Vercel detects Next.js automatically — leave the build settings alone.
4. Expand **Environment Variables** and add the same two values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   Apply each to Production, Preview and Development.
5. **Deploy**, then open the `*.vercel.app` URL. You should see the Circle hello
   page.

From then on, every push to `main` deploys automatically and every pull request
gets a preview URL.

> **Free-tier note:** claim the [GitHub Student Developer Pack](https://education.github.com)
> if you are eligible — it includes a free domain for a year.

---

## Ground rules

These are enforced by tests, not by good intentions. Full detail in
[docs/PLAN.md §4](docs/PLAN.md) and [CLAUDE.md](CLAUDE.md).

1. Money is integer **kobo** (`BIGINT`). No floats, ever, anywhere in a money path.
2. Every value movement is **two ledger rows** in one transaction. The ledger sums to zero.
3. `ledger_entries` is **append-only**. Corrections are reversing entries, never edits.
4. Balances are **computed** from the ledger, never stored as mutable numbers.
5. Every mutating request carries an **idempotency key**. Replays are no-ops.
6. State changes go through **state machines** only, and each one writes an `events` row.
7. LLM features always have a **non-LLM fallback**. A model outage never breaks a user flow.
