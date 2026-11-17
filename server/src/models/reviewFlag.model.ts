import { Schema, Types, model } from 'mongoose';
import { tenantScopePlugin } from './tenantPlugin.js';
import type { ListCursor } from '../utils/cursor.js';

export type ReviewFlagType = 'POSSIBLE_DUPLICATE' | 'UNUSUALLY_LARGE' | 'LOW_CONFIDENCE' | 'CLASSIFICATION_FAILED';
export type ReviewFlagStatus = 'open' | 'resolved';

export interface ReviewFlagDocument {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  transactionId: Types.ObjectId;
  type: ReviewFlagType;
  reason: string;
  details: Record<string, unknown> | null;
  status: ReviewFlagStatus;
  resolvedBy: Types.ObjectId | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const reviewFlagSchema = new Schema<ReviewFlagDocument>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organisation' },
    transactionId: { type: Schema.Types.ObjectId, required: true, ref: 'Transaction' },
    type: {
      type: String,
      enum: ['POSSIBLE_DUPLICATE', 'UNUSUALLY_LARGE', 'LOW_CONFIDENCE', 'CLASSIFICATION_FAILED'],
      required: true,
    },
    reason: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['open', 'resolved'], required: true, default: 'open' },
    resolvedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'review_flags' },
);

// One flag per (transaction, type), so a detector that fires twice on the
// same transaction just hits a duplicate-key error the second time.
reviewFlagSchema.index({ transactionId: 1, type: 1 }, { unique: true });
reviewFlagSchema.index({ organisationId: 1, status: 1, createdAt: -1 });
reviewFlagSchema.plugin(tenantScopePlugin);

export const ReviewFlagModel = model<ReviewFlagDocument>('ReviewFlag', reviewFlagSchema);

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | undefined)?.code === 11000;
}

export interface CreateFlagInput {
  transactionId: string;
  type: ReviewFlagType;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Idempotent through the unique (transactionId, type) index: a detector that
 * runs twice over the same transaction raises the flag once. Insert-first,
 * same as transaction ingestion — never check-then-insert.
 */
export async function createFlag(organisationId: string, input: CreateFlagInput): Promise<void> {
  try {
    await ReviewFlagModel.create({
      organisationId,
      transactionId: input.transactionId,
      type: input.type,
      reason: input.reason,
      details: input.details ?? null,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return;
    }
    throw error;
  }
}

export function listFlagsForTransaction(organisationId: string, transactionId: string): Promise<ReviewFlagDocument[]> {
  return ReviewFlagModel.find({ organisationId, transactionId }).sort({ createdAt: 1 }).lean();
}

export interface ListFlagsFilters {
  status?: ReviewFlagStatus;
  cursor?: ListCursor;
  limit: number;
}

export async function listFlags(
  organisationId: string,
  filters: ListFlagsFilters,
): Promise<{ flags: ReviewFlagDocument[]; hasMore: boolean }> {
  const filter: Record<string, unknown> = { organisationId };
  if (filters.status) filter.status = filters.status;
  if (filters.cursor) {
    filter.$or = [
      { createdAt: { $lt: filters.cursor.date } },
      { createdAt: filters.cursor.date, _id: { $lt: filters.cursor.id } },
    ];
  }

  const docs = await ReviewFlagModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(filters.limit + 1)
    .lean();

  const hasMore = docs.length > filters.limit;
  return { flags: hasMore ? docs.slice(0, filters.limit) : docs, hasMore };
}

export function findFlagById(organisationId: string, flagId: string): Promise<ReviewFlagDocument | null> {
  return ReviewFlagModel.findOne({ organisationId, _id: flagId }).lean();
}

/** Resolves only if still open, so resolving twice is a no-op the caller can detect (null back). */
export function resolveFlag(
  organisationId: string,
  flagId: string,
  resolvedBy: string,
): Promise<ReviewFlagDocument | null> {
  return ReviewFlagModel.findOneAndUpdate(
    { organisationId, _id: flagId, status: 'open' },
    { $set: { status: 'resolved', resolvedBy, resolvedAt: new Date() } },
    { new: true },
  ).lean();
}

/** Called from a correction: a human categorising a transaction resolves any LOW_CONFIDENCE/CLASSIFICATION_FAILED flag on it. */
export async function resolveOpenFlagsForTransaction(
  organisationId: string,
  transactionId: string,
  types: ReviewFlagType[],
  resolvedBy: string,
): Promise<void> {
  await ReviewFlagModel.updateMany(
    { organisationId, transactionId, type: { $in: types }, status: 'open' },
    { $set: { status: 'resolved', resolvedBy, resolvedAt: new Date() } },
  );
}

export function countOpenFlags(organisationId: string): Promise<number> {
  return ReviewFlagModel.countDocuments({ organisationId, status: 'open' });
}
