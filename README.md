# Sycamore Transaction Intelligence Platform

A multi-tenant platform for Nigerian businesses to import transactions, have them
categorised automatically, see which ones need a human to look at them, and correct the
categories. Built for the Sycamore Capital Group technical assessment.

Backend: Node.js, TypeScript, Express, PostgreSQL 16 with Prisma. Frontend: React with Vite.

## 1. Running it

### With Docker (recommended)

You need Docker with Compose. From the repository root:

1. Create `.env` in the repo root:

   ```
   JWT_SECRET=<a long random string>
   SEED_PASSWORD=Passw0rd!2024
   ```

   Generate a secret with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
   The database passwords have local development defaults in `docker-compose.yml`; set
   `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` or `SYSTEM_DB_PASSWORD` here to override them.

2. Create `server/.env`, used when you run the seed or tests from your machine:

   ```
   DATABASE_URL=postgresql://sycamore_app:app_dev_password@localhost:5432/sycamore
   SYSTEM_DATABASE_URL=postgresql://sycamore_system:system_dev_password@localhost:5432/sycamore
   MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sycamore
   JWT_SECRET=<the same value as above>
   SEED_PASSWORD=Passw0rd!2024
   ```

3. Start everything and load the sample data:

   ```bash
   docker compose up -d --build
   cd server && npm install && npm run seed
   ```

   Compose starts Postgres, applies the migrations (`migrate` service), then starts the
   API on :4000, the classification worker and the web app on :5173.

4. Wait a few seconds for the worker to categorise the seeded transactions, then open
   http://localhost:5173 and sign in:

   | Organisation | Email | Role |
   |---|---|---|
   | Lagos Fresh Foods Ltd | `adaeze.okafor@lagosfreshfoods.ng` | admin |
   | Lagos Fresh Foods Ltd | `tunde.balogun@lagosfreshfoods.ng` | member |
   | Nimbus Cloud Systems Ltd | `chidi.eze@nimbuscloud.ng` | admin |
   | Nimbus Cloud Systems Ltd | `funmi.adeyemi@nimbuscloud.ng` | member |

   Every seed user's password is `SEED_PASSWORD`.

`curl http://localhost:4000/health` should report `"status":"ok"` and an empty
classification queue. `docker compose down -v` stops everything and deletes the data.

### Without Docker

You need Node.js 22+ and PostgreSQL 16. As a superuser, create a `sycamore` database and
the two roles the app connects as:

```bash
psql -U postgres -c "CREATE DATABASE sycamore"
psql -U postgres -v app_password=app_dev_password -v system_password=system_dev_password \
  -v db_name=sycamore -f server/prisma/init/roles.sql
```

Then, with `server/.env` as above and `web/.env` containing
`VITE_API_URL=http://localhost:4000/api/v1`:

```bash
cd server && npm install && npm run db:migrate && npm run seed
npm run dev          # API on :4000
npm run worker       # classification worker, in a second terminal
cd ../web && npm install && npm run dev   # web app on :5173
```

### Commands

| Command (in `server/`) | What it does |
|---|---|
| `npm run dev` / `npm run worker` | API / worker with reload |
| `npm test` | All tests, against a throwaway `sycamore_test` database |
| `npm run typecheck` | Type-check source and tests |
| `npm run seed` | Load the sample data (safe to re-run) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:status` | Show which migrations are applied |
| `npm run requeue-failed` | Put every organisation's failed classifications back in the queue |
| `npm run openapi` | Regenerate `docs/openapi.json` |

## 2. Architecture

```
server/
  prisma/
    schema.prisma        tables, keys, indexes
    migrations/          SQL, including what Prisma can't express (see §5)
    init/roles.sql       the two database roles the app connects as
  src/
    config/              env validation (the process exits on bad config), OpenAPI spec
    context/             per-request context: requestId, organisationId, userId, role
    db/                  Prisma clients for the two roles; withTenant()
    repositories/        every database query lives here
    services/            business rules: imports, classification, review, dashboard
    controllers/ routes/ middleware/ validation/   the HTTP layer
    utils/               money (kobo) parsing, cursors, typed errors, JSON logger
    index.ts  worker.ts  the two processes
web/src/                 React app: Dashboard, Transactions, Transaction review
```

A transaction's life:

```mermaid
flowchart LR
    A["POST /transactions(/batch)"] -->|"INSERT ... ON CONFLICT DO NOTHING"| B[("transactions\nstatus: pending")]
    B -->|"worker: claim a batch\nFOR UPDATE SKIP LOCKED"| C{rules}
    C -->|match| D[("classification_events\nsource: rule")]
    C -->|no match| E["AI provider\n5s timeout, validated answer"]
    E -->|answer| D2[("classification_events\nsource: ai")]
    E -->|"down / slow / rate limited"| F["retry with backoff,\nnever gives up"]
    E -->|"unusable answer"| F2["retry; after 5,\nstatus failed + flag"]
    F --> B
    F2 --> B
    D --> H{"confidence < 0.6?"}
    D2 --> H
    H -->|yes| I[("review_flags\nLOW_CONFIDENCE")]
    I --> K["Review in the web app"]
    K -->|"POST /transactions/:id/corrections"| L["new classification_event (human)\n+ category updated, one DB transaction"]
```

After each classification attempt two detectors look at the raw transaction:
`POSSIBLE_DUPLICATE` (same amount, account and direction under a different reference within
24 hours) and `UNUSUALLY_LARGE` (a debit more than the organisation's multiple, default 5x, of
the account's median debit over 90 days, unless a similar payment went out 20 to 40 days
earlier, which makes it a monthly payment like payroll or rent). Every flag carries a
sentence saying why, with naira amounts.

## 3. Decisions and why

**PostgreSQL, not MongoDB.** I started this project on MongoDB and moved it to Postgres; the
commit history shows both. For money, I want the database to enforce the rules rather than
trust the application to: `BIGINT` amounts with a `CHECK (amount_kobo > 0)`, foreign keys
that include the organisation so a transaction can't point at another tenant's account,
row-level security so the database itself refuses cross-tenant reads, and ordinary
transactions without a replica set. Mongo can be made correct for this, and the earlier
version was, but every one of those guarantees lived in my code.

**Prisma.** Typed queries and a readable schema for the common cases. Where it can't express
something, I use plain SQL rather than fight it: the CHECK constraints, trigger and policies
are in the migration file, and three queries use `$queryRaw` (the worker's claim, the
dashboard totals and the median for the large-payment detector).

**The transactions table is the queue.** Each row carries `classification_status`,
`attempts`, `next_attempt_at` and `locked_until`. The worker claims up to 25 due rows with one
`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`, so several workers can run
side by side without waiting on each other or claiming the same row (there's a test for
that). A crashed worker's rows are reclaimed once their lock expires. This avoids running
Redis or SQS for a prototype; scenario 3 covers when that stops being enough.

**Rules before AI.** A rule hit is free, instant and explainable, so the provider only sees
narrations the rules can't decide. Imports never touch the classification code at all.

**Express**, because it's widely known and its router makes the auth boundary obvious:
public routes, then one router with `authMiddleware` mounted on it for everything else.

## 4. Financial correctness

Worked example, **₦12,999.75**:

1. The API only accepts the amount as a string matching `^\d+(\.\d{1,2})?$`. A JSON number
   (`12999.75`) is rejected with a message explaining why, not coerced.
2. `parseAmountToKobo` (`utils/money.ts`) splits on the decimal point and builds a `bigint`:
   `12999n * 100n + 75n = 1299975n`. No `parseFloat`, no `Number()`, no `* 100`.
3. Stored in a `BIGINT` column with `CHECK (amount_kobo > 0)`; the direction carries the sign.
   A test writes and reads back a value above `Number.MAX_SAFE_INTEGER` unchanged.
4. Totals are summed in SQL and cast back to `BIGINT` (`SUM` over `BIGINT` returns `NUMERIC`
   in Postgres), so they arrive as exact bigints.
5. Formatted back to `"12999.75"` by string construction. The large-payment median uses
   `percentile_disc`, which returns one of the real amounts, not an interpolated float.

**Transfers between the organisation's own accounts** (a payroll top-up, for example) are one
debit and one credit inside the same business. Counting them would inflate inflows and
outflows equally and show the move as spending, so transactions categorised `TRANSFERS` are
left out of inflows, outflows and spending by category and shown on their own as "Between own
accounts". Net cash flow is the same either way.

## 5. Tenant isolation

Three layers:

1. **Request context.** `organisationId` comes only from the verified JWT, set once in
   `auth.middleware.ts`, never from a body, query string or path.
2. **Repositories.** Every query in `repositories/` takes `organisationId` and filters by it.
3. **Row-level security in Postgres.** Every tenant table has a policy that only shows and
   accepts rows matching `app.organisation_id`. `withTenant()` (`db/tenant.ts`) runs each
   piece of work in a transaction that sets it first, with `set_config(..., true)` so it
   can't leak to the next request on the same pooled connection. With nothing set, every
   table looks empty. `FORCE ROW LEVEL SECURITY` applies the policies to the table owner too.

The API connects as `sycamore_app`, which is subject to the policies. A second role,
`sycamore_system` (`BYPASSRLS`), is used only where work has to span organisations, and each
use is commented: the worker's claim query, the queue counts in `/health`, finding a user by
email at login (before the organisation is known), and the seed script. After claiming, the
worker does everything else through `withTenant()`. Migrations run as the database owner, a
third identity; neither app role can change the schema.

A resource from another organisation always returns 404. Tests cover the API (accounts,
transactions, flags, corrections) and the database directly: a query with no organisation
filter returns only the current tenant's rows, writing a row for another tenant is refused,
and a transaction can't reference another tenant's account.

## 6. AI reliability

`ClassificationProvider` is a one-method interface (`classify(input, signal)`), and
`providers.ts` picks the implementation from `CLASSIFIER_PROVIDER`. Only `mock` exists. A real
vendor would be one more object implementing the interface; the worker, retries, breaker,
flags and history wouldn't change. A test swaps in a fake provider at runtime to prove it.

Failure handling (`classification.service.ts`):

- **5-second timeout** through `AbortController`.
- **Answers are validated** with Zod. An unknown category or a confidence outside 0 to 1 is
  an unusable answer, not something to cast.
- **Two kinds of failure.** Down, slow or rate-limited says nothing about the transaction, so
  it retries with exponential backoff and jitter (capped at 60s, or the provider's
  `Retry-After`) for as long as the outage lasts and is never marked failed. An unusable
  answer counts against the transaction: after 5 it becomes `failed` with a
  `CLASSIFICATION_FAILED` flag.
- **Circuit breaker.** After 5 consecutive outage-type failures the worker stops calling the
  provider for 30s. Rows claimed meanwhile wait until it closes, and the skipped attempt isn't
  counted. Rules keep working throughout. The breaker is per process.
- **Getting failed rows back.** `POST /classification/retry-failed` (admin only) or
  `npm run requeue-failed` resets them to pending. When one then classifies, the worker
  resolves its flag.
- **Corrections** add a `human` event with the previous category, the user and an optional
  note. `classification_events` has a trigger that rejects UPDATE and DELETE, so the history
  can't be rewritten.

The mock has modes (`MOCK_LLM_MODE=ok|slow|down|rate_limited|invalid`) so every path above
can be exercised. In `ok` mode it uses a few keyword hints so recognisable narrations get a
sensible category at 62 to 94% confidence and vague ones get a low-confidence guess, which is
what produces `LOW_CONFIDENCE` flags in the demo data. It only picks categories that fit the
direction.

**Observability.** Logs are one JSON object per line, filtered by `LOG_LEVEL`. Each request
logs its `requestId`, organisation, path, status and duration; the same `requestId` is in the
`x-request-id` header and every error body. The worker logs provider failures, the breaker
opening and closing, unusable answers and give-ups. `GET /health` reports the database plus
the queue: `pending`, `processing`, `failed` and `oldestDueSeconds`, how long the oldest due
row has waited. That last number is the one to alert on.

## 7. Testing

109 tests with Vitest and supertest, against a real Postgres. `npm test` drops and recreates a
`sycamore_test` database, applies the migration SQL and runs every file; it only needs a
Postgres server (`docker compose up -d postgres` is enough). The tests cover what the brief
calls out: money parsing and round-tripping, idempotency under 20 concurrent identical
imports, batch partial failures, tenancy through the API and directly against the database,
each provider failure mode, the circuit breaker, requeueing, concurrent batch claims, audit
history, review status, and one positive and one negative case per detector. The web app was
checked by hand in a browser against the full stack.

## 8. Assumptions and trade-offs

- **NGN only**, enforced by validation and a CHECK constraint.
- **Roles.** Only requeueing (organisation-wide) is admin-only. Importing, correcting and
  resolving are everyday finance work and open to members; every correction records who
  made it.
- **Login rate limiting and the circuit breaker are in memory**, so they're per process.
  Several instances would need them in Redis.
- **Keyset pagination without totals.** No "page 3 of 40", because a total count gets slower as
  the table grows.
- **Search** is a case-insensitive substring match on narration, merchant and reference,
  backed by trigram indexes. Fine at this size; a search engine would be the next step.
- **No sign-up or invite flow.** Organisations, users and accounts come from the seed script.
- **Seed data** is about 400 transactions across two organisations over three months,
  including recurring rent and payroll, a duplicate pair, an unusually large payment and
  some vague narrations.

## 9. Design scenarios

**The classification provider is down for six hours while hundreds of thousands of
transactions arrive.** Imports keep succeeding, because they never call the provider; rows
queue as `pending`. Rules keep classifying whatever they match. For the rest, the circuit
breaker stops calls after five failures and retries every 30s, so a dead provider isn't
hammered or billed. Outage failures never mark a row as failed, so the finance team doesn't
come back to a wall of `CLASSIFICATION_FAILED` flags. `oldestDueSeconds` in `/health` climbs
and is what should page someone. When the provider recovers, the backlog drains oldest first
with no manual step; to drain faster, run more workers, which is safe because claims use
`SKIP LOCKED`. Anything that did fail (the provider came back answering badly, say) goes back
with `requeue-failed`.

**Keeping AI cost down at millions of transactions a day.** Rules first, since every rule hit
is a model call saved. Then cache answers by a normalised narration and merchant across all
organisations, because businesses share the same bank-fee wording and the same vendors.
Batch many transactions into one model call. Use a small, cheap model first and only send
low-confidence answers to a stronger one. And turn human corrections (`classification_events`
with source `human`) into new rules regularly, so the share of traffic that needs a model keeps
shrinking.

**Scaling from 100,000 to 10 million transactions a day.** That's roughly 115 a second on
average, more at peaks. In order: partition `transactions` by month so recent queries and
indexes stay small and old months can be archived; run the API and workers as several
instances, with the rate limiter and breaker moved to Redis; add a read replica for the
dashboard and listing, and pre-aggregate daily totals per organisation so the dashboard stops
summing raw rows; move ingestion behind a queue (SQS or Kafka) so bursts are absorbed and
workers scale on queue depth; keep median-style detector inputs as running per-account
statistics instead of computing them per transaction. The very largest tenants could later get
their own database.

**A customer says wrong categories have made their finance team distrust the dashboard.**
Start with the transactions they're pointing at: `GET /transactions/:id` shows which rule or
model produced each category and at what confidence. If they were already flagged
`LOW_CONFIDENCE` and never reviewed, part of the fix is the review workflow (make the queue
visible, show confidence on the dashboard). If one vendor or narration pattern is
consistently wrong, add a rule the same day. Measure the correction rate by source to see
whether rules or the model are the problem, and feed their corrections back as rules. Until
trust is back, show how much of each total is unreviewed AI output, so the numbers are honest
about their certainty.

## 10. Unfinished work and next steps

- The OpenAPI spec (`docs/openapi.json`, served at `GET /docs`) is written by hand rather
  than generated from the Zod schemas.
- No automated UI tests and no CI configuration.
- `minAmount` and `maxAmount` filters exist in the API but not in the web app's filter bar.
- No metrics endpoint or tracing yet; Prometheus counters for classifications by source,
  provider latency and breaker state would come next.
- Only one admin-only endpoint; a real deployment would want finer permissions.
- A real provider adapter (for example an OpenAI model with a JSON schema response) behind
  the existing interface.

## How I worked

I used an AI coding assistant for parts of the implementation and the tests. The design decisions are mine.
