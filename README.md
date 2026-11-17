# Sycamore Transaction Intelligence Platform

A multi-tenant transaction import, AI-assisted categorisation, and human review platform
for Nigerian businesses, built for the Sycamore Capital Group technical assessment.

I am not expected to have built a production-complete system in this time box. What follows
explains what I built, why, and what I'd do differently with more time.

## 1. Running it

### Prerequisites

- **Docker + Docker Compose** (the recommended path; this is all you need), **or**
- **Node.js 22+** and a MongoDB 7 replica set of your own, if you'd rather run it without
  Docker (see [Running without Docker](#running-without-docker) below).

### Quick start (Docker)

From the repository root:

**1. Generate a JWT secret:**

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**2. Create `.env` in the repo root** (read by `docker-compose.yml` for the container
environment) with:

```
JWT_SECRET=<paste the generated value>
SEED_PASSWORD=Passw0rd!2024
MOCK_LLM_MODE=ok
MOCK_LLM_FAILURE_RATE=0
```

**3. Create `server/.env`** (read when `npm run seed` runs from your host instead of inside
a container) with:

```
NODE_ENV=development
PORT=4000
MONGO_URI=mongodb://localhost:27017/sycamore?replicaSet=rs0&directConnection=true
JWT_SECRET=<the same value as above>
LOG_LEVEL=info
MOCK_LLM_MODE=ok
MOCK_LLM_FAILURE_RATE=0
WORKER_POLL_INTERVAL_MS=1000
WORKER_LOCK_MS=30000
SEED_PASSWORD=Passw0rd!2024
```

**4. Build and start MongoDB (as a replica set), the API, the classification worker, and
the web app:**

```bash
docker compose up -d --build
```

**5. Load two organisations and ~400 transactions through the real import API:**

```bash
cd server && npm run seed
```

Give the worker a few seconds to classify the newly seeded transactions, then open
**http://localhost:5173** and log in as:

| Organisation | Email | Password |
|---|---|---|
| Lagos Fresh Foods Ltd (food retail) | `adaeze.okafor@lagosfreshfoods.ng` | `Passw0rd!2024` |
| Nimbus Cloud Systems Ltd (SaaS) | `chidi.eze@nimbuscloud.ng` | `Passw0rd!2024` |

(The password is `Passw0rd!2024`, the `SEED_PASSWORD` in `server/.env` above; both seed
organisations use it.)

**Checking it's actually up**, if anything looks wrong:

```bash
docker compose ps                              # all five services should be "running"
curl http://localhost:4000/health              # {"status":"ok","db":"connected"}
curl -o /dev/null -w "%{http_code}\n" http://localhost:5173   # 200
```

**Stopping it:**

```bash
docker compose down            # stops and removes the containers, keeps the data
docker compose down -v         # also deletes the MongoDB data volume (next start reseeds clean)
```

**If you change any source file** after the stack is already running, the containers won't
pick it up automatically: `docker compose up -d --build` only copies code in at image-build
time, it isn't a live mount. Re-run `docker compose up -d --build` (optionally with just the
one service that changed, e.g. `docker compose up -d --build web`) to rebuild and restart.

### Running without Docker

Create `server/.env` with the same content shown in step 3 above, but point `MONGO_URI` at
your own replica set. Create `web/.env` with:

```
VITE_API_URL=http://localhost:4000/api/v1
```

Then:

```bash
cd server && npm install && npm run dev      # terminal 1: the API, on :4000
cd server && npm run worker                  # terminal 2: the classification worker
cd web && npm install && npm run dev         # terminal 3: the web app, on :5173
```

`JWT_SECRET` is never committed and never hardcoded in source; it's read once, at startup,
via `process.env.JWT_SECRET` (`server/src/config/env.ts`).

Then, from `server/`, run `npm run seed` once to load the sample data (needs `server/.env`
in place so it can reach your MongoDB). Your own MongoDB must be running as a replica set,
even a single-node one, because the correction endpoint uses a multi-document transaction,
which Mongo only supports on a replica set.

### Command reference

| Command | Where | What it does |
|---|---|---|
| `docker compose up -d --build` | repo root | Build and start everything |
| `docker compose down` | repo root | Stop everything |
| `docker compose logs -f api\|worker\|web\|mongo` | repo root | Tail one service's logs |
| `npm run dev` | `server/` | Run the API with hot reload |
| `npm run worker` | `server/` | Run the classification worker |
| `npm test` | `server/` | Run the API test suite (needs Mongo reachable) |
| `npm run typecheck` | `server/` or `web/` | Type-check without emitting |
| `npm run seed` | `server/` | Load the sample organisations/accounts/transactions (idempotent, safe to re-run) |
| `npm run openapi` | `server/` | Regenerate `docs/openapi.json` |
| `npm run requeue-failed` | `server/` | Put every organisation's failed classifications back in the queue |
| `npm run dev` | `web/` | Run the web app with hot reload |
| `npm run build` | `web/` | Type-check and build the web app for production |

## 2. Architecture

```
server/src/
  config/        env parsing, DB connection, OpenAPI spec; the process exits on invalid config
  constants/     the fixed category list
  context/       AsyncLocalStorage-based request context (organisationId, userId, role)
  controllers/   parses the request, calls the service, sends the response
  middleware/    request id, JWT auth, login rate limiting, the global error handler
  models/        Mongoose schemas plus the data-access functions for each collection
                 (no separate repository layer; services never import Mongoose directly)
  routes/        Express Router() wiring per resource
  services/      the rules: idempotency, tenant checks, orchestration
    auth/        argon2 verify + JWT sign/verify
    classification/  rules engine, mock LLM provider, the worker's claim loop
    review/      duplicate/large-payment detectors
  seed/          deterministic seed data, loaded through the real import service
  utils/         money (kobo) parsing/formatting, cursor encoding, typed errors
  validation/    Zod schemas at the HTTP boundary
  app.ts         builds the Express app: middleware, routes, error handling
  index.ts       API process entry point
  worker.ts      worker process entry point
web/src/
  api/           typed fetch client
  auth/          token + user in localStorage
  components/    Layout, MoneyValue, StatusBadge, SpendingBars
  pages/         Dashboard, Transactions, Transaction detail/review
```

One transaction's life, import to corrected category:

```mermaid
flowchart LR
    A["POST /transactions(/batch)"] -->|insert-first; E11000 on retry = duplicate| B[("transactions\nstatus: pending")]
    B -->|"worker: one atomic findOneAndUpdate"| C{classifyWithRules}
    C -->|rule hit, confidence >= 0.9| D[("classification_events\nsource: rule")]
    C -->|no rule| E[Mock LLM provider\n5s timeout, Zod-validated output]
    E -->|success| D2[("classification_events\nsource: ai")]
    E -->|"down / timeout / rate limited\n(never gives up)"| F["backoff + jitter, capped at 60s\nnextAttemptAt = now + delay"]
    E -->|"invalid answer, fewer than 5 so far"| F
    F --> B
    E -->|"5th invalid answer"| G["status: failed\n+ CLASSIFICATION_FAILED flag"]
    G -->|"POST /classification/retry-failed\nor npm run requeue-failed"| B
    D --> H{confidence < 0.6?}
    D2 --> H
    H -->|yes| I[("review_flags\nLOW_CONFIDENCE")]
    H -->|no| J[transaction.category set]
    I --> K["GET /review/flags\n(web: Dashboard, Transaction review)"]
    K -->|"POST /transactions/:id/corrections"| L["classification_events: source=human\n+ transaction.category updated\n(one multi-doc transaction)"]
    L --> M["resolves LOW_CONFIDENCE /\nCLASSIFICATION_FAILED on it"]
```

Two detectors (`POSSIBLE_DUPLICATE`, `UNUSUALLY_LARGE`) run after every classification
attempt, independent of whether it succeeded. They're about the raw transaction, not its
category.

## 3. Decisions and why

- **Express** over Fastify/NestJS: the most widely known Node HTTP framework, with a
  middleware model that maps directly onto the three-layer tenant isolation design: a
  public router, then a second `Router()` with `authMiddleware` mounted on it before any
  protected route, so the auth check lives in exactly one place (`server/src/app.ts`). The
  one thing Fastify gives for free that Express doesn't is forwarding a rejected promise from
  an async handler to the error middleware; `utils/asyncHandler.ts` wraps every controller to
  cover that gap.
- **MongoDB** for financial data: the honest case against it is that it enforces nothing
  about tenant isolation, referential integrity, or numeric precision on its own. Three
  specific gaps, each covered by something explicit rather than by convention:
  - Tenant isolation: a Mongoose plugin (`models/tenantPlugin.ts`) throws on any query/update/
    aggregate against a tenant collection with no `organisationId` in the filter.
  - Numeric precision: amounts are stored as 64-bit `Long`, never `Double`; see §4.
  - Referential integrity (nothing stops an `accountId` pointing at a deleted account): the
    data-access functions in `models/` are the only code that writes, and every write path
    that creates a transaction first confirms the account exists in the caller's organisation.
  What Mongo *does* give for free that mattered: a document model that fits "a transaction
  carries its own classification state" far more naturally than a normalized row would, and
  multi-document transactions (replica set required, which is why `docker-compose.yml`'s
  `mongo-init` runs `rs.initiate()`) for the one place two documents must change atomically
  (a correction).
- **No external queue.** The transaction document *is* the queue entry: `classification.
  {status, attempts, nextAttemptAt, lockedUntil}` plus one atomic `findOneAndUpdate` claim
  (`models/transaction.model.ts`) gets retry, backoff, and crash recovery (an expired lock
  gets reclaimed) without running or operating Redis/SQS/RabbitMQ. The cost: no priority
  ordering beyond "oldest due first," and polling (`WORKER_POLL_INTERVAL_MS`) instead of a
  push. See design scenario 3 for where this stops being the right call.
- **Rules before AI, always.** A rule hit is free, instant, and auditable (`rules.ts`); the
  AI step only ever sees narrations rules couldn't decide. This is also why ingestion never
  touches the classification provider at all; the two are fully decoupled modules.

## 4. Financial correctness

Worked example: **₦12,999.75**.

1. The API rejects anything that isn't a string matching `^\d+(\.\d{1,2})?$`. A JSON number
   (`12999.75`) is rejected with a message saying why, not silently coerced.
2. `parseAmountToKobo` (`server/src/utils/money.ts`) splits on the decimal point and combines
   with `bigint` multiplication: `12999n * 100n + 75n = 1299975n`. No `parseFloat`, no
   `Number()`, no `* 100`.
3. Stored as `Schema.Types.BigInt` → BSON `Long`. The driver is configured with
   `useBigInt64: true` (`config/database.ts`), so it round-trips back out as a native
   `bigint`, not the `mongodb.Long` wrapper object. This is proved with a test that stores and
   rereads a value above `Number.MAX_SAFE_INTEGER` (`tests/ingestion.test.ts`).
4. Summed in aggregation (dashboard totals, spending by category) as `Long` the whole way.
   MongoDB's `$sum` over an integer BSON type stays integer server-side, and `useBigInt64`
   is what brings that back as `bigint` client-side instead of silently widening to a
   double.
5. Formatted back to `"12999.75"` by `formatKoboAsAmount`, again by string construction, not
   division.

One real bug came out of this area, worth remembering: `Model.aggregate()` does **not** cast
`$match` against the schema the way `Model.find()` does. Passing the plain string `organisationId`
into an aggregation pipeline's `$match` compared it against a stored `ObjectId` and matched
nothing: every dashboard total came back `0`, silently, for every organisation. Fixed with
an explicit `new mongoose.Types.ObjectId(organisationId)` in `models/transaction.model.ts`'s
`summarizeTransactions`.

The web app only ever formats these decimal strings (`web/src/money/money.ts`); the one
place it compares amounts by magnitude (sizing a spending bar) does the comparison in
`bigint`, converting to a JS number only for the final 0-100 percentage, which is already a small
exact integer with nothing to lose.

## 5. Tenant isolation

Three layers, as specified:

1. **Request context.** `organisationId` is set exactly once, in `middleware/auth.middleware.ts`,
   from the verified JWT's claim, never read from a body, query string, or path parameter.
   `requireOrganisationId()` is the only way code gets it.
2. **Models.** Every data-access function in `models/` takes `organisationId` as a required
   first argument and puts it in the filter.
3. **The Mongoose plugin backstop.** `tenantScopePlugin` throws on any `find`/`update`/
   `aggregate`/`save`/`insertMany` against a tenant collection (`accounts`, `transactions`,
   `classification_events`, `review_flags`) with no `organisationId` in the filter, as a
   second line of defence if a model-layer mistake ever shipped.

**One documented exception each way:**

- The worker's claim query (`models/transaction.model.ts`'s `claimNextTransaction`) is the
  one explicit, commented bypass of the plugin. By design it looks across every
  organisation at once, since it doesn't yet know which organisation's transaction is next.
- `users` carries `organisationId` like every other tenant collection, but is **not**
  wrapped with the plugin: logging in means finding a user by email *alone*, before
  `organisationId` is known, which is exactly the query the plugin exists to forbid. Adding
  a second bypass for it would have contradicted the rule that there's only one. Every other
  read of `users` still takes `organisationId` as an explicit filter (defence in depth, just
  without the Mongoose-level backstop).

A resource outside the caller's organisation always returns `404`, never `403`. This is tested for
accounts, transactions, review flags, and corrections.

## 6. AI reliability

`ClassificationProvider` (`services/classification/provider.ts`) is a small interface (one
`classify(input, signal)` method), so the AI backend can be swapped (mock today, a real
vendor later) without touching the worker, the retry logic, or anything upstream. Rules are
deliberately *not* an implementation of it; they're a synchronous pre-filter that runs
first and never needs swapping.

Failure handling, all in `classification.service.ts`:

- **5-second timeout** via `AbortController`, regardless of which `MOCK_LLM_MODE` is active.
- **Zod-validated output** (`validation/classification.validation.ts`): an unknown category or an
  out-of-range confidence is treated as a failure, not cast.
- **Exponential backoff with jitter** between attempts, capped at 60s; a rate-limited
  response honours its own `retryAfterMs` instead of the generic backoff.
- **Two kinds of failure, treated differently.** If the provider is down, times out or rate
  limits us, that says nothing about the transaction, so it keeps retrying for as long as
  the outage lasts and is never marked failed. If the provider answers but the answer is
  unusable (unknown category, confidence out of range), that counts against the
  transaction: after 5 of those (`classification.invalidResponses`) it moves to
  `status: failed` with a `CLASSIFICATION_FAILED` flag for a human.
- **Circuit breaker**: after 5 consecutive outage-type failures, stop calling the provider
  for a 30s cool-off. A transaction claimed during the cool-off is pushed back to when the
  breaker closes (plus a few seconds of jitter) and the skipped attempt isn't counted,
  because the provider was never called. Rules keep classifying the whole time. In-memory
  and per-process.
- **Getting failed rows back.** `POST /classification/retry-failed` requeues the caller's
  organisation's failed transactions with their counters reset, and `npm run requeue-failed`
  does the same for every organisation (one organisation at a time, through the same scoped
  function, so the tenant guard still applies). When a requeued transaction classifies, the
  worker resolves its `CLASSIFICATION_FAILED` flag.
- **Ingestion never depends on any of this.** Import handlers (`transactions.service.ts`)
  never import the classification module at all, so a provider outage changes nothing about
  whether `POST /transactions` succeeds, tested directly (`classification.test.ts`,
  "ingestion does not depend on AI").

`MOCK_LLM_MODE` (`ok | slow | down | rate_limited | invalid`) plus `MOCK_LLM_FAILURE_RATE`
let every one of those failure paths be exercised on demand; `setMockLlmMode` /
`setMockLlmFailureRate` (`mockLlmProvider.ts`) make that possible mid-test-run without a
restart.

## 7. Testing

94 tests, Vitest, `supertest` against the Express app, run against a real MongoDB replica
set (no mocked database). `server/tests/setup.ts` connects once per run; most fixtures use a
fresh organisation/user per test so tests never depend on execution order. The one
exception is `classification.test.ts`, which documents at the top of the file why it drains
the worker's globally-shared claim queue before each test.

```
cd server
docker compose up -d mongo mongo-init    # from the repo root, or use the full stack
npm test                                   # everything
npm test -- tests/classification.test.ts   # one file
npm run typecheck
```

Coverage maps closely onto what the brief calls out explicitly: money, idempotency and
concurrency, tenancy, every classification failure mode, audit history, one positive and one
negative case per detector. The web app was verified by driving a real browser against the
real stack rather than with a Vitest/RTL suite (see §10).

## 8. Assumptions and trade-offs

- **NGN only.** `currency` must be exactly `"NGN"`; anything else is a validation error.
  Multi-currency would need an FX layer and a currency-aware `largePaymentMultiple`, out of
  scope here.
- **Roles are stored but not enforced.** `admin`/`member` exist on `User`, but no endpoint
  checks either: anyone authenticated in an organisation can import, correct, and resolve.
  A reasonable cut for a prototype at this scope; real role-gating would be next.
- **Login rate limiting and the classification circuit breaker are in-memory,
  per-process.** Correct for one API/worker instance; a horizontally scaled deployment would
  need both moved to a shared store (Redis), as noted at each definition site.
- **Keyset pagination only, no total counts.** `GET /transactions` and `GET /review/flags`
  never expose "page 3 of 40" because that would need a `count()` that gets slower as the
  collection grows; "Load more" / cursor-forward is the trade for staying fast at scale.
- **The web UI doesn't expose every filter the API supports.** `minAmount`/`maxAmount` work
  against the API (tested) but aren't wired into the Transactions page's filter bar, to keep
  that bar usable rather than exhaustive.
- **Seed volume** is ~400 transactions total (193 + 202) across two organisations over three
  months: comfortably "a few hundred" in aggregate, on the lower end of that phrase read
  per-organisation. Generating more would be a matter of widening the weekly loops in
  `server/src/seed/generateTransactions.ts`, not a design change.
- **No admin/invite flow.** Organisations, users, and accounts only exist via the seed
  script or direct database access; there's no `POST /organisations` or `POST /users`. Out
  of scope for what the brief asks the API to do.

## 9. Design scenarios

**AI reliability: a six-hour outage with hundreds of thousands of transactions arriving.**
Nothing about ingestion changes: imports keep succeeding and queue up as `pending`, because
the import path never calls the classification provider. Rules keep classifying whatever
they match for the whole six hours. For the rest, the worker tries the provider, and after
five consecutive failures the circuit breaker stops calling it for 30s at a time, so retries
don't become extra load on (or billed cost against) a service that's down. Transactions
claimed while the breaker is open are pushed back to when it closes, and those skipped calls
don't count as attempts. An outage never marks a transaction as failed: only unusable
answers do, so six hours of downtime doesn't turn into hundreds of thousands of
`CLASSIFICATION_FAILED` flags for the finance team. Once the provider recovers, the backlog
drains oldest-due-first with no manual step. If something did end up `failed` (for example
the provider came back returning bad answers for a while),
`POST /classification/retry-failed` or `npm run requeue-failed` puts it back in the queue.
At "hundreds of thousands" scale a single worker process would take a
while to catch up, so the lever to pull is running more worker replicas (safe already, since
the claim is one atomic `findOneAndUpdate`) and watching `pendingClassificationCount` on the
dashboard as the signal for whether to add more.

**AI cost at millions of transactions a day, without hurting accuracy.** Rules absorbing as
much deterministic volume as possible is already the design and is the single biggest cost
lever available, since every rule hit is a model call avoided. Beyond that: cache classification
results by a normalised `(narration, merchant)` key across the whole platform, not per
organisation, since unrelated businesses share the same bank-fee boilerplate and the same
handful of cloud vendors; batch several transactions into one LLM call instead of one call
per row; route to a cheap/small model first and escalate to a stronger one only when its own
confidence is low; and feed back corrections (`classification_events` with `source: human`)
into new rules on a regular cadence, so the set of narrations that actually need the model
keeps shrinking over time instead of staying fixed.

**Scaling from 100,000 to 10 million transactions a day.** The current design (single Mongo
replica set, one worker polling, in-memory rate limiter and breaker) is right-sized for the
lower end, not the upper one. At 10M/day I'd: shard `transactions` by `organisationId` (the
natural tenant boundary, and already the leading field of every index); replace poll-and-
claim with a real queue (SQS/Kafka) so there's back-pressure and consumer groups instead of
one claim loop competing with itself; move the rate limiter and circuit breaker to Redis so
they're correct across replicas instead of per-process; add a denormalised read model for
the dashboard so heavy aggregation stops competing with the hot write path; and introduce
time-based partitioning/archiving so the working set for recent-data queries doesn't keep
growing forever.

**Product trust: a customer says AI categorisation is making their finance team distrust
the dashboard.** First step is data, not reassurance: pull `GET /transactions/:id` for the
specific transactions they're pointing at and look at `classificationHistory`: which
provider or rule produced the category, and at what confidence. If those transactions are
sitting on an unresolved `LOW_CONFIDENCE` flag, the system already knew it wasn't sure; the
complaint may be as much about the review workflow not being used as about accuracy itself.
If a specific vendor or narration pattern is consistently wrong, that's a same-day fix: add
a rule for it, which takes effect with zero latency and no model change, exactly because
rules exist for this. And check whether their own corrections are flowing anywhere: the
audit trail (`classification_events`) is the raw material for exactly this feedback loop,
and if it's just sitting there un-mined, that's the real process gap to close.

## 10. Unfinished work and possible next steps

- Hand-maintained OpenAPI spec (`docs/openapi.json`, `GET /docs`) rather than generated from
  the Zod schemas. `@asteasolutions/zod-to-openapi` would close that gap but means every
  validation schema registering itself with the spec instead of staying a plain `.parse()`
  call in the controller.
- No automated UI test suite; the web app was verified against the real stack in a browser
  rather than with Playwright/RTL.
- `minAmount`/`maxAmount` filters exist in the API but not the Transactions page's UI.
- No role gating, no admin/invite endpoints, no CI pipeline config.
- Login rate limiting and the classification circuit breaker are per-process; both are
  clearly marked at their definition site as the first things to move to a shared store in a
  multi-instance deployment.
- The large-payment detector loads the account's last 90 days of debits into memory to
  find the median, once per transaction. Fine at prototype volume; at scale I'd keep a
  running per-account median (or a percentile sketch) updated on insert, or compute it with
  an aggregation over a pre-bucketed daily summary instead.
- Search by reference is an exact match: a single token with a digit in it is treated as a
  reference rather than text, because Mongo's text index splits `TRF/0012` into pieces.
  Partial reference search would need a prefix index or a search engine.
- `GET /health` reports database connectivity but not the pending-classification backlog
  size in its body yet. `pendingClassificationCount` is already computed for the dashboard
  and would be a small addition to wire the same query into the health check.
