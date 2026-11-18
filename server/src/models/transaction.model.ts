import mongoose, { Schema, Types, model } from 'mongoose';
import { CATEGORIES, type Category } from '../constants/categories.js';
import { tenantScopePlugin, TENANT_GUARD_BYPASS } from './tenantPlugin.js';
import { ClassificationEventModel, type ClassificationEventDocument } from './classificationEvent.model.js';
import type { ListCursor } from '../utils/cursor.js';

export type Direction = 'credit' | 'debit';
export type ClassificationStatus = 'pending' | 'processing' | 'classified' | 'failed';
export type ClassificationSource = 'rule' | 'ai' | 'human';
export type ReviewStatus = 'none' | 'open' | 'resolved';

export interface TransactionCategory {
  value: Category;
  source: ClassificationSource;
  confidence: number;
  eventId: Types.ObjectId;
}

export interface TransactionClassificationState {
  status: ClassificationStatus;
  attempts: number;
  invalidResponses: number;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  lastError: string | null;
}

export interface TransactionDocument {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  accountId: Types.ObjectId;
  externalReference: string;
  amountKobo: bigint;
  direction: Direction;
  currency: 'NGN';
  narration: string;
  merchant: string | null;
  date: Date;
  category: TransactionCategory | null;
  classification: TransactionClassificationState;
  reviewStatus: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<TransactionCategory>(
  {
    value: { type: String, enum: CATEGORIES, required: true },
    source: { type: String, enum: ['rule', 'ai', 'human'], required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'ClassificationEvent' },
  },
  { _id: false },
);

const classificationSchema = new Schema<TransactionClassificationState>(
  {
    status: {
      type: String,
      enum: ['pending', 'processing', 'classified', 'failed'],
      required: true,
      default: 'pending',
    },
    attempts: { type: Number, required: true, default: 0 },
    // Only bad answers count towards giving up. An unreachable, slow or
    // rate-limited provider says nothing about this transaction, so those
    // failures retry until the provider is back (see classification.service.ts).
    invalidResponses: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { _id: false },
);

const transactionSchema = new Schema<TransactionDocument>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organisation' },
    accountId: { type: Schema.Types.ObjectId, required: true, ref: 'Account' },
    externalReference: { type: String, required: true },
    amountKobo: { type: Schema.Types.BigInt, required: true }, // BSON Long, see config/database.ts
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    currency: { type: String, enum: ['NGN'], required: true, default: 'NGN' },
    narration: { type: String, required: true },
    merchant: { type: String, default: null },
    date: { type: Date, required: true },
    category: { type: categorySchema, default: null },
    classification: { type: classificationSchema, required: true, default: () => ({}) },
    reviewStatus: { type: String, enum: ['none', 'open', 'resolved'], required: true, default: 'none' },
  },
  { timestamps: true, collection: 'transactions' },
);

// This is what actually decides a duplicate import: importTransaction()
// below always attempts the insert and reacts to the E11000 this throws,
// rather than checking existence first.
transactionSchema.index({ organisationId: 1, accountId: 1, externalReference: 1 }, { unique: true });
transactionSchema.index({ organisationId: 1, date: -1, _id: -1 });
transactionSchema.index({ organisationId: 1, accountId: 1, date: -1, _id: -1 });
transactionSchema.index({ organisationId: 1, 'category.value': 1, date: -1 });
transactionSchema.index({ organisationId: 1, reviewStatus: 1, date: -1 });
transactionSchema.index({ organisationId: 1, accountId: 1, direction: 1, amountKobo: 1, date: 1 });
transactionSchema.index({ organisationId: 1, narration: 'text', merchant: 'text' });
transactionSchema.index({ organisationId: 1, externalReference: 1 });
transactionSchema.index({ 'classification.status': 1, 'classification.nextAttemptAt': 1 });

transactionSchema.plugin(tenantScopePlugin);

export const TransactionModel = model<TransactionDocument>('Transaction', transactionSchema);

// ---------------------------------------------------------------------------
// Import / idempotency
// ---------------------------------------------------------------------------

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

interface MongoWriteError {
  index: number;
  code?: number;
  errmsg?: string;
  err?: { code?: number; errmsg?: string };
}

interface MongoBulkWriteError {
  writeErrors?: MongoWriteError[];
  insertedDocs?: unknown[];
}

function errorCode(error: unknown): number | undefined {
  return (error as { code?: number } | undefined)?.code;
}

function isDuplicateKeyError(error: unknown): boolean {
  return errorCode(error) === 11000;
}

function isBulkWriteError(error: unknown): error is MongoBulkWriteError {
  return typeof error === 'object' && error !== null && 'writeErrors' in error;
}

export type InsertResult = { outcome: 'inserted'; document: TransactionDocument } | { outcome: 'duplicate' };

/**
 * Always attempts the insert; never checks existence first. The unique index
 * above is what decides a duplicate, so under concurrent identical requests
 * exactly one insert wins and the rest learn about it from this error, not
 * from a prior read.
 */
export async function insertTransaction(input: NewTransactionInput): Promise<InsertResult> {
  try {
    const doc = await TransactionModel.create(input);
    return { outcome: 'inserted', document: doc.toObject() };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { outcome: 'duplicate' };
    }
    throw error;
  }
}

export function findByReference(
  organisationId: string,
  accountId: string,
  externalReference: string,
): Promise<TransactionDocument | null> {
  return TransactionModel.findOne({ organisationId, accountId, externalReference }).lean();
}

export function findById(organisationId: string, transactionId: string): Promise<TransactionDocument | null> {
  return TransactionModel.findOne({ organisationId, _id: transactionId }).lean();
}

export interface BatchInsertOutcome {
  inserted: Array<{ position: number; document: TransactionDocument }>;
  duplicatePositions: number[];
  // Rows the database rejected for a reason other than a duplicate key. The
  // rest of the batch is unaffected, so these are reported per row instead
  // of failing the whole request.
  failed: Array<{ position: number; error: string }>;
}

/**
 * `ordered: false` so one bad row never blocks the rest. On a partial
 * failure the driver throws rather than returning a result, so the success
 * list has to be read back out of the error, and this is the only place that
 * reads that shape.
 */
export async function insertManyTransactions(docs: NewTransactionInput[]): Promise<BatchInsertOutcome> {
  if (docs.length === 0) {
    return { inserted: [], duplicatePositions: [], failed: [] };
  }

  try {
    const created = await TransactionModel.insertMany(docs, { ordered: false });
    return {
      inserted: created.map((document, position) => ({ position, document: document.toObject() })),
      duplicatePositions: [],
      failed: [],
    };
  } catch (error) {
    if (!isBulkWriteError(error)) {
      throw error;
    }

    const writeErrors = error.writeErrors ?? [];
    const failedPositions = new Set(writeErrors.map((writeError) => writeError.index));
    const isDuplicate = (writeError: MongoWriteError) => (writeError.err?.code ?? writeError.code) === 11000;

    const insertedPositions = docs.map((_, position) => position).filter((position) => !failedPositions.has(position));
    const insertedDocs = (error.insertedDocs ?? []) as Array<{ toObject?: () => TransactionDocument } & TransactionDocument>;

    return {
      inserted: insertedPositions.map((position, order) => {
        const doc = insertedDocs[order] as { toObject?: () => TransactionDocument } & TransactionDocument;
        return { position, document: doc.toObject ? doc.toObject() : doc };
      }),
      duplicatePositions: writeErrors.filter(isDuplicate).map((writeError) => writeError.index),
      failed: writeErrors
        .filter((writeError) => !isDuplicate(writeError))
        .map((writeError) => ({
          position: writeError.index,
          error: writeError.err?.errmsg ?? writeError.errmsg ?? 'Database rejected this row',
        })),
    };
  }
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

async function isExistingReference(organisationId: string, q: string): Promise<boolean> {
  if (!/^\S+$/.test(q)) return false;
  const match = await TransactionModel.exists({ organisationId, externalReference: q });
  return Boolean(match);
}

export async function listTransactions(
  organisationId: string,
  filters: TransactionListFilters,
): Promise<{ transactions: TransactionDocument[]; hasMore: boolean }> {
  const filter: Record<string, unknown> = { organisationId };
  if (filters.accountId) filter.accountId = filters.accountId;
  if (filters.direction) filter.direction = filters.direction;
  if (filters.category) filter['category.value'] = filters.category;
  if (filters.reviewStatus) filter.reviewStatus = filters.reviewStatus;

  if (filters.from || filters.to) {
    const dateRange: Record<string, Date> = {};
    if (filters.from) dateRange.$gte = filters.from;
    if (filters.to) dateRange.$lte = filters.to;
    filter.date = dateRange;
  }

  if (filters.minAmountKobo !== undefined || filters.maxAmountKobo !== undefined) {
    const amountRange: Record<string, bigint> = {};
    if (filters.minAmountKobo !== undefined) amountRange.$gte = filters.minAmountKobo;
    if (filters.maxAmountKobo !== undefined) amountRange.$lte = filters.maxAmountKobo;
    filter.amountKobo = amountRange;
  }

  // Mongo's text index splits a reference like "GTB-88213" or "lff-operating-dup-a"
  // into pieces, so a single-word query is first tried as an exact
  // externalReference (an indexed lookup). If no transaction has that
  // reference, it falls back to the normal text search over narration and
  // merchant ("Dangote", "rent").
  if (filters.q) {
    if (await isExistingReference(organisationId, filters.q)) {
      filter.externalReference = filters.q;
    } else {
      filter.$text = { $search: filters.q };
    }
  }

  if (filters.cursor) {
    filter.$or = [
      { date: { $lt: filters.cursor.date } },
      { date: filters.cursor.date, _id: { $lt: filters.cursor.id } },
    ];
  }

  const docs = await TransactionModel.find(filter)
    .sort({ date: -1, _id: -1 })
    .limit(filters.limit + 1)
    .lean();

  const hasMore = docs.length > filters.limit;
  return { transactions: hasMore ? docs.slice(0, filters.limit) : docs, hasMore };
}

// ---------------------------------------------------------------------------
// Classification state transitions
// ---------------------------------------------------------------------------

/**
 * Claims whichever due transaction comes first: `pending` and due now, or
 * `processing` with an expired lock (a crashed worker's job). This is the
 * one of two commented bypasses of the tenant-guard plugin. It has to look
 * across every organisation at once, since it doesn't know yet which one's
 * transaction is next.
 */
export async function claimNextTransaction(lockMs: number): Promise<TransactionDocument | null> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + lockMs);

  const claimed = await TransactionModel.findOneAndUpdate(
    {
      $or: [
        { 'classification.status': 'pending', 'classification.nextAttemptAt': { $lte: now } },
        { 'classification.status': 'processing', 'classification.lockedUntil': { $lte: now } },
      ],
    },
    {
      $set: { 'classification.status': 'processing', 'classification.lockedUntil': lockedUntil },
      $inc: { 'classification.attempts': 1 },
    },
    { sort: { 'classification.nextAttemptAt': 1 }, new: true },
  ).setOptions({ [TENANT_GUARD_BYPASS]: true });

  return claimed ? claimed.toObject() : null;
}

// Every transition below takes organisationId and filters by it, even though
// the worker already has it from the document it just claimed. Only the
// claim query itself skips that.

export async function markClassified(
  organisationId: string,
  transactionId: string,
  category: Category,
  source: ClassificationSource,
  confidence: number,
  eventId: string,
): Promise<void> {
  await TransactionModel.updateOne(
    { organisationId, _id: transactionId },
    {
      $set: {
        category: { value: category, source, confidence, eventId },
        'classification.status': 'classified',
        'classification.lastError': null,
      },
    },
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
  const inc: Record<string, number> = {};
  if (options.refundAttempt) inc['classification.attempts'] = -1;
  if (options.invalidResponse) inc['classification.invalidResponses'] = 1;

  await TransactionModel.updateOne(
    { organisationId, _id: transactionId },
    {
      $set: {
        'classification.status': 'pending',
        'classification.lastError': errorMessage,
        'classification.nextAttemptAt': nextAttemptAt,
        'classification.lockedUntil': null,
      },
      ...(Object.keys(inc).length > 0 ? { $inc: inc } : {}),
    },
  );
}

export async function markFailed(organisationId: string, transactionId: string, errorMessage: string): Promise<void> {
  await TransactionModel.updateOne(
    { organisationId, _id: transactionId },
    {
      $set: { 'classification.status': 'failed', 'classification.lastError': errorMessage, 'classification.lockedUntil': null },
      $inc: { 'classification.invalidResponses': 1 },
    },
  );
}

// attempts and invalidResponses go back to zero: a requeue is a fresh start.
function requeueUpdate() {
  return {
    $set: {
      'classification.status': 'pending',
      'classification.attempts': 0,
      'classification.invalidResponses': 0,
      'classification.nextAttemptAt': new Date(),
      'classification.lockedUntil': null,
    },
  };
}

/** Puts this organisation's failed transactions back in the queue, e.g. after a provider fix. */
export async function requeueFailed(organisationId: string): Promise<number> {
  const result = await TransactionModel.updateMany(
    { organisationId, 'classification.status': 'failed' },
    requeueUpdate(),
  );
  return result.modifiedCount;
}

/**
 * A human correction: one classification_events insert plus one transaction
 * update, in a single multi-document transaction (needs Mongo running as a
 * replica set). Also moves classification.status to 'classified', since a
 * transaction a human just categorised shouldn't be eligible for the worker
 * to claim and overwrite with a rule/AI guess.
 */
export async function applyCorrection(
  organisationId: string,
  transactionId: string,
  previousCategory: Category | null,
  newCategory: Category,
  actorUserId: string,
  note: string | undefined,
): Promise<ClassificationEventDocument> {
  const session = await mongoose.startSession();
  try {
    let event: ClassificationEventDocument | undefined;
    await session.withTransaction(async () => {
      const [created] = await ClassificationEventModel.create(
        [
          {
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
        ],
        { session },
      );
      event = created!.toObject();

      await TransactionModel.updateOne(
        { organisationId, _id: transactionId },
        {
          $set: {
            category: { value: newCategory, source: 'human', confidence: 1, eventId: event._id },
            'classification.status': 'classified',
            'classification.lastError': null,
            'classification.lockedUntil': null,
          },
        },
        { session },
      );
    });
    return event!;
  } finally {
    await session.endSession();
  }
}

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
 * Queue counts across every organisation, for GET /health. Like the worker's
 * claim query, this has to look across organisations, so it's the second
 * commented bypass of the tenant guard. It only ever returns numbers, never
 * documents, so nothing about any organisation's transactions leaves it.
 */
export async function classificationQueueStats(): Promise<ClassificationQueueStats> {
  const now = new Date();
  const count = (status: ClassificationStatus) =>
    TransactionModel.countDocuments({ 'classification.status': status }).setOptions({ [TENANT_GUARD_BYPASS]: true });

  const [pending, processing, failed, oldestDue] = await Promise.all([
    count('pending'),
    count('processing'),
    count('failed'),
    TransactionModel.findOne({ 'classification.status': 'pending', 'classification.nextAttemptAt': { $lte: now } })
      .sort({ 'classification.nextAttemptAt': 1 })
      .select({ 'classification.nextAttemptAt': 1 })
      .setOptions({ [TENANT_GUARD_BYPASS]: true })
      .lean(),
  ]);

  const dueAt = oldestDue?.classification.nextAttemptAt;
  return {
    pending,
    processing,
    failed,
    oldestDueSeconds: dueAt ? Math.max(0, Math.round((now.getTime() - dueAt.getTime()) / 1000)) : null,
  };
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
  spendingByCategory: CategorySpend[];
  pendingClassificationCount: number;
}

function dateMatch(range: DashboardRange): Record<string, Date> | undefined {
  if (!range.from && !range.to) return undefined;
  const match: Record<string, Date> = {};
  if (range.from) match.$gte = range.from;
  if (range.to) match.$lte = range.to;
  return match;
}

export async function summarizeTransactions(organisationId: string, range: DashboardRange): Promise<DashboardTotals> {
  // Model.aggregate() doesn't cast $match against the schema like find()
  // does, so a plain string here would never match the stored ObjectId.
  const match: Record<string, unknown> = { organisationId: new mongoose.Types.ObjectId(organisationId) };
  const dateFilter = dateMatch(range);
  if (dateFilter) match.date = dateFilter;

  // $sum over amountKobo (a Long) stays a 64-bit integer on the server;
  // useBigInt64 on the driver brings it back as bigint, not a double.
  const [totals] = await TransactionModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        inflowsKobo: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amountKobo', 0n] } },
        outflowsKobo: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amountKobo', 0n] } },
      },
    },
  ]);

  const spendingByCategory = await TransactionModel.aggregate([
    { $match: { ...match, direction: 'debit', 'category.value': { $ne: null } } },
    { $group: { _id: '$category.value', totalKobo: { $sum: '$amountKobo' } } },
    { $sort: { totalKobo: -1 } },
  ]);

  const pendingClassificationCount = await TransactionModel.countDocuments({
    organisationId,
    'classification.status': { $in: ['pending', 'processing'] },
  });

  return {
    inflowsKobo: totals?.inflowsKobo ?? 0n,
    outflowsKobo: totals?.outflowsKobo ?? 0n,
    spendingByCategory: spendingByCategory.map((row) => ({ category: row._id as Category, totalKobo: row.totalKobo as bigint })),
    pendingClassificationCount,
  };
}
