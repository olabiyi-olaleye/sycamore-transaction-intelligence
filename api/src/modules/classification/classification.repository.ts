import { TENANT_GUARD_BYPASS } from '../../db/tenantPlugin.js';
import {
  TransactionModel,
  type ClassificationSource,
  type TransactionDocument,
} from '../../db/models/transaction.model.js';
import {
  ClassificationEventModel,
  type ClassificationEventDocument,
} from '../../db/models/classificationEvent.model.js';
import type { Category } from '../transactions/categories.js';

/**
 * Atomically claims whichever due transaction comes first: `pending` and due
 * now, or `processing` with an expired lock (a crashed worker's job). This is
 * the one explicit, commented bypass of the tenant-guard plugin in the whole
 * app — by design it has to look across every organisation at once, because
 * it does not yet know which organisation's transaction is next.
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

export interface NewClassificationEvent {
  transactionId: string;
  source: ClassificationSource;
  provider: string;
  category: Category;
  previousCategory: Category | null;
  confidence: number | null;
  reason: string;
  actorUserId?: string;
  note?: string;
}

export function insertEvent(
  organisationId: string,
  event: NewClassificationEvent,
): Promise<ClassificationEventDocument> {
  return ClassificationEventModel.create({ organisationId, ...event }).then((doc) => doc.toObject());
}

export function listEventsForTransaction(
  organisationId: string,
  transactionId: string,
): Promise<ClassificationEventDocument[]> {
  return ClassificationEventModel.find({ organisationId, transactionId }).sort({ createdAt: 1 }).lean();
}

// Every transition below takes organisationId as the first argument and
// filters by it even though the worker already knows it from the claimed
// document — the claim query is the only query in this module allowed to
// skip that.

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

export async function scheduleRetry(
  organisationId: string,
  transactionId: string,
  errorMessage: string,
  nextAttemptAt: Date,
): Promise<void> {
  await TransactionModel.updateOne(
    { organisationId, _id: transactionId },
    {
      $set: {
        'classification.status': 'pending',
        'classification.lastError': errorMessage,
        'classification.nextAttemptAt': nextAttemptAt,
        'classification.lockedUntil': null,
      },
    },
  );
}

export async function markFailed(organisationId: string, transactionId: string, errorMessage: string): Promise<void> {
  await TransactionModel.updateOne(
    { organisationId, _id: transactionId },
    { $set: { 'classification.status': 'failed', 'classification.lastError': errorMessage, 'classification.lockedUntil': null } },
  );
}
