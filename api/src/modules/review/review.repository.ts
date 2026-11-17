import { OrganisationModel } from '../../db/models/organisation.model.js';
import { ReviewFlagModel, type ReviewFlagDocument, type ReviewFlagStatus, type ReviewFlagType } from '../../db/models/reviewFlag.model.js';
import type { ListCursor } from '../transactions/cursor.js';

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

/** Organisations are not a module of their own in this app (see BUILD_PLAN.md); this is
 * the one setting review detectors need, so it lives next to the detector that reads it. */
export async function getLargePaymentMultiple(organisationId: string): Promise<number> {
  const org = await OrganisationModel.findById(organisationId).lean();
  return org?.settings.largePaymentMultiple ?? 5;
}
