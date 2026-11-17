import { ReviewFlagModel, type ReviewFlagDocument, type ReviewFlagType } from '../../db/models/reviewFlag.model.js';

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
