# PLAN.md — Circle: Digitized Savings Groups (Ajo/Esusu)

> **This is the source of truth.** Every coding session starts by reading this file, `ARCHITECTURE.md`, and `CLAUDE.md`. If a decision here conflicts with code, this file wins — or this file gets updated first, then the code.

---

## 1. Vision

Hundreds of millions of people save through informal rotating savings circles (ajo/esusu in Nigeria, chamas, tandas elsewhere). Members contribute a fixed amount each period; one member takes the whole pot each round. It runs on trust and a notebook — and it breaks: missed payments, disputes, no records.

**Circle** is the app that runs the circle: transparent ledger, automated reminders, a trust/reliability layer, and AI-assisted dispute resolution.

**Portfolio goal:** demonstrate full-stack + AI engineering with a real product — ledger correctness, state machines, bot integration, LLM features with evals, and real users (friends/family pilot circles).

---

## 2. MVP Scope (v1) — ruthlessly cut

**One circle type only:**
- Fixed group of N members
- Fixed contribution amount per round (in Naira, stored as integer kobo)
- Fixed rotation order (set at circle creation)
- N rounds — every member receives the pot exactly once
- Monthly cadence (configurable period length, but one cadence per circle)

**v1 money model = P2P (zero cost, zero custody):**
- Money moves by **direct bank transfer between members** (outside the app)
- The app is the **brain**: tracks whose turn it is, records contributions, reconciles claims
- Contributor taps **"I've paid"** → recipient taps **"Received"** → ledger entry confirmed
- Mismatched claims (paid but not received) → dispute flow
- We NEVER hold or move funds in v1. This avoids Nigerian licensed-financial-institution territory entirely.

**Explicit non-goals for v1:** variable amounts, interest, lending, multiple currencies, payment processing (Paystack), WhatsApp API, native mobile apps, trust score v2 (ML-based).

---

## 3. The $0 Stack

| Layer | Tool | Free tier notes |
|---|---|---|
| Frontend + API | **Next.js (App Router) on Vercel** | Frontend AND API routes in one deploy; free subdomain |
| Database | **Supabase free tier (Postgres)** | 500MB — enormous for this. Also gives free Auth |
| Auth | **Supabase Auth** | Email + phone login; don't build auth from scratch |
| Scheduled jobs | **GitHub Actions cron** | Nightly reconciliation check, deadline reminders |
| Notifications | **Telegram Bot API** | Completely free, unlimited. Plus web push from PWA + free email tier (Resend/Brevo) |
| AI | **Gemini API free tier** (fallback: Groq free tier) | Reminder composer, dispute summarizer |
| CI | **GitHub Actions** | Tests + eval suite on every push |
| Code | **GitHub** | Public repo — this IS the portfolio |

**Known free-tier gotchas (design around, don't be surprised by):**
1. Supabase free Postgres **pauses after ~1 week of inactivity** → add a weekly GitHub Action ping to keep it warm.
2. Vercel serverless has **cold starts** — first request after idle is slow. Fine at pilot scale.
3. Free LLM tiers have **rate limits** — the app never hits them, but eval runs might → add delay between eval cases.
4. Claim the **GitHub Student Developer Pack** (education.github.com): free domain (Namecheap 1yr), cloud credits, JetBrains IDEs.

**Future adapters (designed for, not built):** Paystack module for real payment rails (v2); WhatsApp Business API replacing Telegram for the Nigerian market (utility messages ≈ ₦10/msg — documented cost model, deliberate v1 exclusion).

---

## 4. Core Invariants (the money rules — NEVER violate)

These are the rules that make this project resume-worthy. Every one gets automated tests.

1. **Double-entry ledger.** Every value movement = exactly two rows (one debit, one credit). The sum across the ledger is always **zero**.
2. **Append-only.** Ledger rows are NEVER updated or deleted. Corrections are new reversing entries.
3. **Balances are computed, never stored** as mutable numbers. (Materialized views/caches allowed, but ledger is truth.)
4. **Money is integer kobo.** Never floats. Never. `amount_kobo BIGINT`.
5. **Idempotency everywhere.** Every state-changing request carries a client-generated idempotency key. Replays are no-ops. (Double-taps, flaky networks, retried webhooks.)
6. **Reconciliation.** A nightly job verifies: ledger sums to zero, every confirmed contribution has matching debit+credit, circle/round state matches ledger reality. Any drift → loud alert. **This job is the single most senior-engineer artifact in the project.**
7. **State machines are explicit.** Circles and rounds move through defined states via defined transitions only (see ARCHITECTURE.md). No implicit state derived from scattered flags.

---

## 5. Data Model (overview — full ERD in ARCHITECTURE.md)

- `users` — Supabase auth + profile (name, phone, telegram_chat_id)
- `circles` — name, amount_kobo, period_days, status, created_by
- `memberships` — user ↔ circle, payout_position (rotation order), status
- `rounds` — circle_id, round_number, recipient_membership_id, due_date, status
- `contributions` — round_id, payer_membership_id, status (pending → claimed → confirmed | disputed), idempotency_key
- `ledger_entries` — the double-entry table: account_id, contribution_id, direction (debit/credit), amount_kobo, created_at. Append-only.
- `accounts` — one virtual account per membership per circle (+ a clearing account per circle)
- `disputes` — contribution_id, opened_by, status, resolution, ai_summary
- `events` — append-only audit log of every state transition (who, what, when) — this is the debugging backbone
- `notifications_log` — every message sent (channel, template, payload, status)

---

## 6. AI Layer (build in this order)

1. **Reminder agent** — composes personalized Telegram nudges. Tone-aware, escalates politely as deadline approaches. English + Pidgin. Cheap, visible, delightful.
2. **Trust score v1** — transparent RULES, not a black box: on-time rate, lateness trend, completed circles. The AI part is the natural-language *explanation* of why a score is what it is. Explainability IS the feature — people share this score with friends.
3. **Dispute assistant** — reads the ledger + events and drafts a neutral summary ("Ledger shows Tunde's March payment was claimed April 2nd, 3 days late; recipient has not confirmed; circle rules say...").

**Eval discipline (non-negotiable — this keeps "AI engineer" honest):**
- `evals/` directory with a golden set of reminder scenarios + dispute cases (target: 50+ cases)
- Each case: input state → expected properties of output (assertions, not exact-match)
- Score tracked per prompt version; eval run wired into CI — a prompt change that drops the score fails the build
- Log every LLM call: prompt version, input, output, latency, cost → `llm_traces` table

---

## 7. Phases

> **Phase discipline:** work on ONE phase at a time. A phase is done when its acceptance criteria pass AND its phase log exists (see §8). Do not start phase N+1 with phase N incomplete.

### Phase 0 — Skeleton & guardrails (Week 1)
- Next.js app scaffold, Supabase project connected, CI running lint + typecheck + tests
- `docs/phases/` structure created; PLAN.md, ARCHITECTURE.md, CLAUDE.md committed
- **Accept:** deployed "hello" page on Vercel; CI green; Supabase reachable from a test.

### Phase 1 — Ledger core with fake money (Weeks 1–3)
- Schema migrations: accounts, ledger_entries, events
- Ledger service: post double-entry, compute balances, reversing entries
- Property tests: ledger always sums to zero; append-only enforced (DB-level: no UPDATE/DELETE grants on ledger_entries)
- Reconciliation job v1 (runs locally + via GitHub Action)
- **Accept:** simulate a full 5-member circle rotation in a test with fake entries; all invariants hold; reconciliation passes.

### Phase 2 — Circle lifecycle & state machines (Weeks 2–3, overlaps 1)
- circles, memberships, rounds, contributions tables + state machines
- Transitions: create circle → invite → activate → open round → claim paid → confirm received → close round → ... → complete circle
- Every transition writes to `events`
- Idempotency keys on all mutating endpoints
- **Accept:** full lifecycle integration test passes; invalid transitions rejected; replayed requests are no-ops.

### Phase 3 — PWA screens (Weeks 4–5)
- Auth (Supabase), create circle, invite via link/phone, circle dashboard (who's paid, whose turn, countdown), "I've paid" / "Received" buttons, history view
- Design for the least technical relative: big buttons, no jargon, works on low-end Android
- **Accept:** a non-technical tester completes a fake round without help.

### Phase 4 — Notifications: Telegram bot + email/push (Week 6)
- Telegram bot: link account, reminder messages, payout-day alerts
- GitHub Actions cron triggers reminder checks
- notifications_log records everything sent
- **Accept:** reminder fires for an unpaid contribution near deadline; log row created.

### Phase 5 — AI reminder agent + eval harness (Weeks 7–8)
- Gemini-composed reminders behind a template fallback (if LLM fails, plain template sends — notifications never break)
- evals/ golden set v1 (25+ reminder cases), CI-integrated, llm_traces logging
- **Accept:** eval suite runs in CI with a score report; toggling a deliberately bad prompt fails the build.

### Phase 6 — Disputes + dispute assistant (Week 9)
- Dispute open/resolve flow; AI-drafted neutral summary from ledger + events
- Add dispute cases to eval set
- **Accept:** mismatched claim (paid, not received) → dispute with a factually correct AI summary citing ledger data.

### Phase 7 — Trust score v1 + polish (Week 10)
- Rules-based score + AI explanation; profile display
- **Accept:** scores match hand-computed values on test fixtures.

### Phase 8 — Real pilot + writeup (Weeks 11–12)
- Run one real circle: 5 friends, ₦1,000/month equivalent (real bank transfers, app as ledger)
- Fix what reality breaks (it will)
- Blog post: "I built a digital ajo system — here's how I made sure it never loses money" (ledger design, reconciliation, the race condition you inevitably hit, eval results)
- **Accept:** one full real round completed; post published; README showcases metrics.

---

## 8. Documentation & Debugging Workflow (how we know what the code did)

**Per-phase logs — `docs/phases/PHASE-XX.md`** (created when a phase starts, updated every session):
- **Goal** (from this plan) · **What was built** (files created/changed, with one-line purpose each) · **Decisions made** (and why — especially deviations from plan) · **How to test it** (exact commands) · **Known issues / TODOs** · **Bugs found & fixed** (symptom → root cause → fix → regression test added)

**`docs/DECISIONS.md`** — running log of architectural decisions (mini-ADRs, 3 lines each).

**`CHANGELOG.md`** — one line per meaningful change, newest first.

**Debugging backbone (when something breaks, look here in order):**
1. `events` table — every state transition with actor + timestamp
2. `ledger_entries` — what the money truth says
3. Reconciliation job output — where the drift is
4. `notifications_log` / `llm_traces` — what was sent / what the AI saw and said
5. The relevant `docs/phases/PHASE-XX.md` — what changed recently and its known issues

**Honest note:** "no mistakes" isn't how software works — bugs WILL happen. This system exists so every bug is *traceable in minutes* and every fix leaves a regression test behind. That's what well-executed actually means.

---

## 9. Testing Strategy

- **Unit tests:** ledger math, state transitions, idempotency, trust score rules
- **Property tests:** ledger-sums-to-zero under random valid operation sequences
- **Integration tests:** full circle lifecycle end-to-end against a test database
- **Eval suite:** LLM outputs scored against golden set (CI-gated)
- **Manual pilot:** the real circle in Phase 8
- Ledger and state-machine code target ~100% coverage. UI can be lighter.

---

## 10. Risks Register

| Risk | Mitigation |
|---|---|
| Holding funds = regulatory territory (NG) | v1 is P2P, app never touches money. Paystack virtual-account design documented for v2 only. Do 1hr of real research before ever accepting funds. |
| Free DB pauses | Weekly keep-alive Action |
| LLM flakiness breaks reminders | Template fallback always; LLM is enhancement, not dependency |
| Scope creep | §2 non-goals list; one circle type; phases are gates |
| Double-tap / replay bugs | Idempotency keys + tests from Phase 2 day one |
| "It works on my phone" | Test on low-end Android + slow 3G throttling |

---

## 11. Resume Payoff (why each part exists)

Ledger + reconciliation → *"built a money system that provably never loses a kobo."* State machines + idempotency → distributed-systems maturity. Telegram bot + cron → real integrations on $0. Eval-gated LLM features → genuine AI engineering, not API-calling. Real pilot + writeup → users, metrics, and a story no interviewer forgets: *"I built for a real behavior tech hasn't served."*



