# ARCHITECTURE.md — Circle

> Diagrams are in **Mermaid** — they render natively on GitHub and in VS Code (install the "Markdown Preview Mermaid Support" extension, then open preview with `Ctrl+Shift+V`).

---

## 1. System architecture ($0 stack, v1)

```mermaid
flowchart TB
    subgraph Clients
        PWA["Members' PWA<br/>(Next.js on Vercel)"]
        TG["Telegram bot"]
    end

    subgraph Vercel["Vercel (free tier)"]
        API["Next.js API routes<br/>circles · rounds · contributions · disputes"]
    end

    subgraph Supabase["Supabase (free tier)"]
        AUTH["Supabase Auth"]
        DB[("Postgres<br/>ledger · events · circles")]
    end

    subgraph GHA["GitHub Actions (cron)"]
        RECON["Nightly reconciliation"]
        REMIND["Reminder scheduler"]
        PING["Weekly DB keep-alive"]
    end

    LLM["Gemini API (free tier)<br/>reminders · dispute summaries"]

    PWA --> API
    PWA --> AUTH
    API --> DB
    TG <--> API
    RECON --> DB
    REMIND --> API
    PING --> DB
    API --> LLM
```

**Key property:** money never enters this system in v1. Bank transfers happen between members outside the app; the app is the ledger, referee, and reminder brain.

---

## 2. Circle & round state machines

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Draft: create circle
    Draft --> Inviting: invites sent
    Inviting --> Active: all members joined,<br/>rotation order locked
    Active --> Completed: final round closed
    Active --> Cancelled: unanimous cancel<br/>(before money claimed)
    Completed --> [*]
    Cancelled --> [*]
```

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Open: round starts,<br/>contributions created
    Open --> Collecting: first claim recorded
    Collecting --> Settled: all contributions confirmed
    Collecting --> Disputed: mismatch (claimed,<br/>not confirmed by deadline)
    Disputed --> Collecting: dispute resolved
    Settled --> Closed: payout acknowledged,<br/>ledger entries posted
    Closed --> [*]
```

**Rule:** these transitions are the ONLY way state changes. Every transition writes a row to `events` (actor, from_state, to_state, timestamp, metadata). No state is ever inferred from scattered boolean flags.

---

## 3. Contribution flow (the core loop)

```mermaid
sequenceDiagram
    actor P as Payer
    actor R as Recipient (this round)
    participant APP as PWA / API
    participant L as Ledger
    participant E as Events log
    participant N as Notifications

    Note over P,R: Bank transfer happens OUTSIDE the app (v1)
    P->>APP: Tap "I've paid" (+ idempotency key)
    APP->>E: contribution: pending → claimed
    APP->>N: Notify recipient via Telegram
    R->>APP: Tap "Received" (+ idempotency key)
    APP->>L: Post double-entry:<br/>debit payer account, credit clearing
    APP->>E: contribution: claimed → confirmed
    APP-->>P: Status: confirmed ✓

    Note over APP: If deadline passes with claim<br/>unconfirmed → auto-open dispute
```

Payout at round close mirrors this: clearing account → recipient account, both sides posted atomically in one transaction.

---

## 4. Double-entry ledger model

```mermaid
flowchart LR
    PA["Payer accounts<br/>(one per membership)"] -- "debit on<br/>confirmed contribution" --> CL["Circle clearing<br/>account"]
    CL -- "credit on<br/>round payout" --> RA["Recipient account<br/>(this round's member)"]
```

Invariants (tested, enforced):
- Every movement = exactly 2 rows (debit + credit), same `amount_kobo`, same transaction.
- `SUM(signed amount) over ledger_entries = 0` — always.
- `ledger_entries` is append-only: the DB role used by the app has **no UPDATE or DELETE grant** on this table. Corrections are reversing entries.
- Balances are computed from entries, never stored as mutable columns.
- Amounts are `BIGINT` kobo. Floats are forbidden in any money path.

---

## 5. Entity-relationship diagram

```mermaid
erDiagram
    USERS ||--o{ MEMBERSHIPS : has
    CIRCLES ||--o{ MEMBERSHIPS : contains
    CIRCLES ||--o{ ROUNDS : schedules
    CIRCLES ||--o{ ACCOUNTS : owns
    MEMBERSHIPS ||--o| ACCOUNTS : "virtual account"
    ROUNDS ||--o{ CONTRIBUTIONS : collects
    MEMBERSHIPS ||--o{ CONTRIBUTIONS : pays
    CONTRIBUTIONS ||--o{ LEDGER_ENTRIES : posts
    CONTRIBUTIONS ||--o| DISPUTES : "may raise"
    USERS {
        uuid id PK
        string name
        string phone
        string telegram_chat_id
    }
    CIRCLES {
        uuid id PK
        string name
        bigint amount_kobo
        int period_days
        string status
    }
    MEMBERSHIPS {
        uuid id PK
        uuid user_id FK
        uuid circle_id FK
        int payout_position
        string status
    }
    ROUNDS {
        uuid id PK
        uuid circle_id FK
        int round_number
        uuid recipient_membership_id FK
        date due_date
        string status
    }
    CONTRIBUTIONS {
        uuid id PK
        uuid round_id FK
        uuid payer_membership_id FK
        string status
        string idempotency_key UK
    }
    LEDGER_ENTRIES {
        uuid id PK
        uuid account_id FK
        uuid contribution_id FK
        string direction
        bigint amount_kobo
        timestamptz created_at
    }
    DISPUTES {
        uuid id PK
        uuid contribution_id FK
        uuid opened_by FK
        string status
        text ai_summary
    }
```

Supporting tables (not shown): `events` (audit backbone), `notifications_log`, `llm_traces`, `accounts`.

---

## 6. AI layer & eval loop

```mermaid
flowchart LR
    STATE["Circle state<br/>(due dates, history)"] --> AGENT["Reminder agent<br/>(Gemini free tier)"]
    AGENT --> FB{"LLM ok?"}
    FB -- yes --> MSG["Personalized message<br/>(EN / Pidgin, tone-aware)"]
    FB -- "no / timeout" --> TPL["Plain template<br/>(always works)"]
    MSG --> TGOUT["Telegram send"]
    TPL --> TGOUT
    AGENT --> TR[("llm_traces<br/>prompt ver · cost · latency")]
    GOLD["evals/ golden set<br/>50+ cases"] --> CI["GitHub Actions:<br/>eval score gate"]
    TR -.-> GOLD
```

The same fallback + tracing + eval pattern applies to the dispute assistant. **LLM features are enhancements, never dependencies** — nothing user-critical breaks if the model is down or rate-limited.

---

## 7. Debugging map — "where do I look when X breaks?"

| Symptom | Look at (in order) |
|---|---|
| "My payment isn't showing" | `contributions.status` → `events` for that contribution → idempotency key collisions |
| Balance looks wrong | `ledger_entries` for the account → reconciliation job output → NEVER edit rows; post a reversing entry |
| Circle stuck in a state | `events` (last transition + actor) → state machine guards in code |
| Reminder never arrived | `notifications_log` → GitHub Action run logs → Telegram chat_id linkage |
| AI said something wrong | `llm_traces` (exact prompt + output) → add the case to `evals/` → fix prompt → CI proves it |
| Anything money-related drifts | Reconciliation report — it names the account and the delta |
