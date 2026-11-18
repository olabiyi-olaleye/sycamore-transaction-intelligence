import { Prisma, type Transaction } from '../generated/prisma/client.js';
import type { Category, ClassificationSource, Direction, ReviewStatus } from '../generated/prisma/enums.js';
import { systemDb } from '../db/client.js';
import { withTenant } from '../db/tenant.js';
import type { ListCursor } from '../utils/cursor.js';

export type { Transaction };

export interface NewTransactionInput {
  organisationId: string;
  accountId: string;
  externalReference: string;
  amountKobo: bigint;
  direction: Direction;
  currency: 'NGN';
  narration: string;
  merchant: string | null;
  date: Date;
}

// ---------------------------------------------------------------------------
// Import / idempotency
// ---------------------------------------------------------------------------

export type InsertResult = { outcome: 'inserted'; transaction: Transaction } | { outcome: 'duplicate' };

/**
 * INSERT ... ON CONFLICT DO NOTHING on (organisation, account, reference).
 * The unique constraint decides a duplicate, so under concurrent identical
 * requests exactly one insert wins and the others get no row back. Nothing
 * is checked first, and no error is raised and caught, which would abort the
 * surrounding transaction.
 */
export async function insertTransaction(input: NewTransactionInput): Promise<InsertResult> {
  const [created] = await withTenant(input.organisationId, (tx) =>
    tx.transaction.createManyAndReturn({ data: [input], skipDuplicates: true }),
  );
  return created ? { outcome: 'inserted', transaction: created } : { outcome: 'duplicate' };
}

export interface BatchInsertOutcome {
  inserted: Array<{ position: number; transaction: Transaction }>;
  duplicatePositions: number[];
  failed: Array<{ position: number; error: string }>;
}

function referenceKey(row: { accountId: string; externalReference: string }): string {
  return `${row.accountId}:${row.externalReference}`;
}

/**
 * One multi-row insert for the whole batch. Rows that come back were
 * created; rows that don't were duplicates. If the statement itself fails
 * (a row the database rejects for some other reason), the batch is retried
 * one row at a time, each in its own transaction, so the bad row is reported
 * on its own and the rest still go in.
 */
export async function insertManyTransactions(organisationId: string, rows: NewTransactionInput[]): Promise<BatchInsertOutcome> {
  if (rows.length === 0) {
    return { inserted: [], duplicatePositions: [], failed: [] };
  }

  try {
    const created = await withTenant(organisationId, (tx) =>
      tx.transaction.createManyAndReturn({ data: rows, skipDuplicates: true }),
    );
    const createdByKey = new Map(created.map((transaction) => [referenceKey(transaction), transaction]));
    const outcome: BatchInsertOutcome = { inserted: [], duplicatePositions: [], failed: [] };
    rows.forEach((row, position) => {
      const transaction = createdByKey.get(referenceKey(row));
      if (transaction) {
        outcome.inserted.push({ position, transaction });
      } else {
        outcome.duplicatePositions.push(position);
      }
    });
    return outcome;
  } catch {
    const outcome: BatchInsertOutcome = { inserted: [], duplicatePositions: [], failed: [] };
    for (const [position, row] of rows.entries()) {
      try {
        const result = await insertTransaction(row);
        if (result.outcome === 'inserted') {
          outcome.inserted.push({ position, transaction: result.transaction });
        } else {
          outcome.duplicatePositions.push(position);
        }
      } catch (error) {
        outcome.failed.push({ position, error: (error as Error).message.split('\n').pop() ?? 'Database rejected this row' });
      }
    }
    return outcome;
  }
}

export function findByReference(organisationId: string, accountId: string, externalReference: string): Promise<Transaction | null> {
  return withTenant(organisationId, (tx) =>
    tx.transaction.findFirst({ where: { organisationId, accountId, externalReference } }),
  );
}

export function findById(organisationId: string, transactionId: string): Promise<Transaction | null> {
  return withTenant(organisationId, (tx) => tx.transaction.findFirst({ where: { organisationId, id: transactionId } }));
}

// ---------------------------------------------------------------------------
// Listing / search
// ---------------------------------------------------------------------------

export interface TransactionListFilters {
  accountId?: string;
  direction?: Direction;
  category?: Category;
  from?: Date;
  to?: Date;
  minAmountKobo?: bigint;
  maxAmountKobo?: bigint;
  reviewStatus?: ReviewStatus;
  q?: string;
  cursor?: ListCursor;
  limit: number;
}

export async function listTransactions(
  organisationId: string,
  filters: TransactionListFilters,
): Promise<{ transactions: Transaction[]; hasMore: boolean }> {
  const and: Prisma.TransactionWhereInput[] = [{ organisationId }];
  if (filters.accountId) and.push({ accountId: filters.accountId });
  if (filters.direction) and.push({ direction: filters.direction });
  if (filters.category) and.push({ category: filters.category });
  if (filters.reviewStatus) and.push({ reviewStatus: filters.reviewStatus });
  if (filters.from) and.push({ date: { gte: filters.from } });
  if (filters.to) and.push({ date: { lte: filters.to } });
  if (filters.minAmountKobo !== undefined) and.push({ amountKobo: { gte: filters.minAmountKobo } });
  if (filters.maxAmountKobo !== undefined) and.push({ amountKobo: { lte: filters.maxAmountKobo } });

  // Case-insensitive substring match, backed by trigram indexes on all three
  // columns, so "dangote", "TRF/00" and a full reference all work.
  if (filters.q) {
    const contains = { contains: filters.q, mode: 'insensitive' as const };
    and.push({ OR: [{ narration: contains }, { merchant: contains }, { externalReference: contains }] });
  }

  // Strictly after the last row of the previous page, in the same
  // (date desc, id desc) order the results are sorted by.
  if (filters.cursor) {
    and.push({
      OR: [{ date: { lt: filters.cursor.date } }, { date: filters.cursor.date, id: { lt: filters.cursor.id } }],
    });
  }

  const rows = await withTenant(organisationId, (tx) =>
    tx.transaction.findMany({
      where: { AND: and },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
    }),
  );

  const hasMore = rows.length > filters.limit;
  return { transactions: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
}

// ---------------------------------------------------------------------------
// Classification queue
// ---------------------------------------------------------------------------

/**
 * Claims up to `limit` due transactions in one statement: `pending` and due
 * now, or `processing` with an expired lock (a crashed worker's job).
 * FOR UPDATE SKIP LOCKED lets several workers claim at once without waiting
 * on or double-claiming each other's rows.
 *
 * Runs as sycamore_system because it has to look across every organisation;
 * it doesn't know whose transaction is due next until it has claimed it.
 * Everything the worker does after the claim goes back through withTenant.
 */
export async function claimDueTransactions(limit: number, lockMs: number): Promise<Transaction[]> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + lockMs);

  const claimed = await systemDb().$queryRaw<Array<{ id: string }>>`
    UPDATE "transactions"
    SET "classification_status" = 'processing',
        "locked_until" = ${lockedUntil},
        "attempts" = "attempts" + 1,
        "updated_at" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "transactions"
      WHERE ("classification_status" = 'pending' AND "next_attempt_at" <= ${now})
         OR ("classification_status" = 'processing' AND "locked_until" <= ${now})
      ORDER BY "next_attempt_at"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;

  if (claimed.length === 0) return [];
  return systemDb().transaction.findMany({
    where: { id: { in: claimed.map((row) => row.id) } },
    orderBy: { nextAttemptAt: 'asc' },
  });
}

// Every transition below takes organisationId and runs through withTenant,
// even though the worker already has the transaction. Only the claim above
// and the queue counts at the bottom of this file work across organisations.

export async function markClassified(
  organisationId: string,
  transactionId: string,
  category: Category,
  source: ClassificationSource,
  confidence: number,
  eventId: string,
): Promise<void> {
  await withTenant(organisationId, (tx) =>
    tx.transaction.updateMany({
      where: { organisationId, id: transactionId },
      data: {
        category,
        categorySource: source,
        categoryConfidence: confidence,
        categoryEventId: eventId,
        classificationStatus: 'classified',
        lastError: null,
        lockedUntil: null,
      },
    }),
  );
}

export interface RetryOptions {
  // The claim already added 1 to attempts. A skipped call (circuit breaker
  // open) never reached the provider, so it gives that attempt back.
  refundAttempt?: boolean;
  invalidResponse?: boolean;
}

export async function scheduleRetry(
  organisationId: string,
  transactionId: string,
  errorMessage: string,
  nextAttemptAt: Date,
  options: RetryOptions = {},
): Promise<void> {
  await withTenant(organisationId, (tx) =>
    tx.transaction.updateMany({
      where: { organisationId, id: transactionId },
      data: {
        classificationStatus: 'pending',
        lastError: errorMessage,
        nextAttemptAt,
        lockedUntil: null,
        ...(options.refundAttempt ? { attempts: { decrement: 1 } } : {}),
        ...(options.invalidResponse ? { invalidResponses: { increment: 1 } } : {}),
      },
    }),
  );
}

export async function markFailed(organisationId: string, transactionId: string, errorMessage: string): Promise<void> {
  await withTenant(organisationId, (tx) =>
    tx.transaction.updateMany({
      where: { organisationId, id: transactionId },
      data: { classificationStatus: 'failed', lastError: errorMessage, lockedUntil: null, invalidResponses: { increment: 1 } },
    }),
  );
}

/** Puts this organisation's failed transactions back in the queue with their counters reset. */
export async function requeueFailed(organisationId: string): Promise<number> {
  const result = await withTenant(organisationId, (tx) =>
    tx.transaction.updateMany({
      where: { organisationId, classificationStatus: 'failed' },
      data: { classificationStatus: 'pending', attempts: 0, invalidResponses: 0, nextAttemptAt: new Date(), lockedUntil: null },
    }),
  );
  return result.count;
}

/**
 * A human correction: one classification_events insert and one transaction
 * update in the same database transaction. Also moves the status to
 * 'classified', so the worker can't claim it and overwrite the person's
 * choice with a rule or AI guess.
 */
export async function applyCorrection(
  organisationId: string,
  transactionId: string,
  previousCategory: Category | null,
  newCategory: Category,
  actorUserId: string,
  note: string | undefined,
): Promise<void> {
  await withTenant(organisationId, async (tx) => {
    const event = await tx.classificationEvent.create({
      data: {
        organisationId,
        transactionId,
        source: 'human',
        provider: 'human',
        category: newCategory,
        previousCategory,
        confidence: null,
        reason: 'Manual correction',
        actorUserId,
        note: note ?? null,
      },
    });
    await tx.transaction.updateMany({
      where: { organisationId, id: transactionId },
      data: {
        category: newCategory,
        categorySource: 'human',
        categoryConfidence: 1,
        categoryEventId: event.id,
        classificationStatus: 'classified',
        lastError: null,
        lockedUntil: null,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Review detectors
// ---------------------------------------------------------------------------

export function findSameAmountNearby(
  organisationId: string,
  transaction: Transaction,
  windowStart: Date,
  windowEnd: Date,
): Promise<Transaction | null> {
  return withTenant(organisationId, (tx) =>
    tx.transaction.findFirst({
      where: {
        organisationId,
        accountId: transaction.accountId,
        direction: transaction.direction,
        amountKobo: transaction.amountKobo,
        externalReference: { not: transaction.externalReference },
        date: { gte: windowStart, lte: windowEnd },
        id: { not: transaction.id },
      },
      orderBy: { date: 'asc' },
    }),
  );
}

/**
 * The account's prior debits over a window: how many there are, and the
 * median, computed in the database. percentile_disc returns one of the
 * actual amounts (the lower middle for an even count), so the result stays
 * a whole number of kobo; percentile_cont would interpolate as a float.
 */
export async function debitStats(
  organisationId: string,
  transaction: Transaction,
  since: Date,
): Promise<{ count: number; medianKobo: bigint | null }> {
  const [row] = await withTenant(organisationId, (tx) =>
    tx.$queryRaw<Array<{ count: bigint; median: bigint | null }>>`
      SELECT count(*) AS "count",
             percentile_disc(0.5) WITHIN GROUP (ORDER BY "amount_kobo") AS "median"
      FROM "transactions"
      WHERE "organisation_id" = ${organisationId}::uuid
        AND "account_id" = ${transaction.accountId}::uuid
        AND "direction" = 'debit'
        AND "date" >= ${since}
        AND "date" <= ${transaction.date}
        AND "id" <> ${transaction.id}::uuid`,
  );
  return { count: Number(row?.count ?? 0n), medianKobo: row?.median ?? null };
}

export async function hasSimilarDebitBetween(
  organisationId: string,
  transaction: Transaction,
  lowerKobo: bigint,
  upperKobo: bigint,
  from: Date,
  to: Date,
): Promise<boolean> {
  const match = await withTenant(organisationId, (tx) =>
    tx.transaction.findFirst({
      where: {
        organisationId,
        accountId: transaction.accountId,
        direction: 'debit',
        amountKobo: { gte: lowerKobo, lte: upperKobo },
        date: { gte: from, lte: to },
        id: { not: transaction.id },
      },
      select: { id: true },
    }),
  );
  return Boolean(match);
}

// ---------------------------------------------------------------------------
// Dashboard totals
// ---------------------------------------------------------------------------

export interface DashboardRange {
  from?: Date;
  to?: Date;
}

export interface CategorySpend {
  category: Category;
  totalKobo: bigint;
}

export interface DashboardTotals {
  inflowsKobo: bigint;
  outflowsKobo: bigint;
  // Money moved between the organisation's own accounts. Each one shows up
  // as a debit on one account and a credit on another, so counting it would
  // inflate inflows and outflows equally and make it look like spending.
  internalTransfersKobo: bigint;
  spendingByCategory: CategorySpend[];
  pendingClassificationCount: number;
}

function dateConditions(range: DashboardRange): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (range.from) parts.push(Prisma.sql`AND "date" >= ${range.from}`);
  if (range.to) parts.push(Prisma.sql`AND "date" <= ${range.to}`);
  return parts.length > 0 ? Prisma.join(parts, ' ') : Prisma.empty;
}

/**
 * SUM over a BIGINT column returns NUMERIC in Postgres, so each total is
 * cast back to BIGINT. That keeps it exact and brings it into the app as a
 * bigint rather than a string or a float.
 */
export async function summarizeTransactions(organisationId: string, range: DashboardRange): Promise<DashboardTotals> {
  const dates = dateConditions(range);

  return withTenant(organisationId, async (tx) => {
    const [totals] = await tx.$queryRaw<Array<{ inflows: bigint; outflows: bigint; transfers: bigint; pending: bigint }>>`
      SELECT
        COALESCE(SUM("amount_kobo") FILTER (WHERE "direction" = 'credit' AND "category" IS DISTINCT FROM 'TRANSFERS'), 0)::bigint AS "inflows",
        COALESCE(SUM("amount_kobo") FILTER (WHERE "direction" = 'debit' AND "category" IS DISTINCT FROM 'TRANSFERS'), 0)::bigint AS "outflows",
        COALESCE(SUM("amount_kobo") FILTER (WHERE "direction" = 'debit' AND "category" = 'TRANSFERS'), 0)::bigint AS "transfers",
        count(*) FILTER (WHERE "classification_status" IN ('pending', 'processing')) AS "pending"
      FROM "transactions"
      WHERE "organisation_id" = ${organisationId}::uuid ${dates}`;

    const spending = await tx.$queryRaw<Array<{ category: Category; total: bigint }>>`
      SELECT "category", SUM("amount_kobo")::bigint AS "total"
      FROM "transactions"
      WHERE "organisation_id" = ${organisationId}::uuid
        AND "direction" = 'debit'
        AND "category" IS NOT NULL
        AND "category" <> 'TRANSFERS'
        ${dates}
      GROUP BY "category"
      ORDER BY "total" DESC`;

    return {
      inflowsKobo: totals?.inflows ?? 0n,
      outflowsKobo: totals?.outflows ?? 0n,
      internalTransfersKobo: totals?.transfers ?? 0n,
      spendingByCategory: spending.map((row) => ({ category: row.category, totalKobo: row.total })),
      pendingClassificationCount: Number(totals?.pending ?? 0n),
    };
  });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface ClassificationQueueStats {
  pending: number;
  processing: number;
  failed: number;
  // How long the oldest transaction that is due for classification has been
  // waiting. Near zero when the worker keeps up; it grows during an outage or
  // when the worker is down, which makes it the number to alert on.
  oldestDueSeconds: number | null;
}

/**
 * Queue counts across every organisation, for GET /health. Runs as
 * sycamore_system because it spans organisations; it only ever returns
 * numbers, never rows.
 */
export async function classificationQueueStats(): Promise<ClassificationQueueStats> {
  const now = new Date();
  const [row] = await systemDb().$queryRaw<
    Array<{ pending: bigint; processing: bigint; failed: bigint; oldest_due: Date | null }>
  >`
    SELECT
      count(*) FILTER (WHERE "classification_status" = 'pending') AS "pending",
      count(*) FILTER (WHERE "classification_status" = 'processing') AS "processing",
      count(*) FILTER (WHERE "classification_status" = 'failed') AS "failed",
      min("next_attempt_at") FILTER (WHERE "classification_status" = 'pending' AND "next_attempt_at" <= ${now}) AS "oldest_due"
    FROM "transactions"`;

  const oldestDue = row?.oldest_due ?? null;
  return {
    pending: Number(row?.pending ?? 0n),
    processing: Number(row?.processing ?? 0n),
    failed: Number(row?.failed ?? 0n),
    oldestDueSeconds: oldestDue ? Math.max(0, Math.round((now.getTime() - oldestDue.getTime()) / 1000)) : null,
  };
}
