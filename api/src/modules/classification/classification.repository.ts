import mongoose from 'mongoose';
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
import { type Category } from '../transactions/categories.js';

/**
 * Claims whichever due transaction comes first: `pending` and due now, or
 * `processing` with an expired lock (a crashed worker's job). This is the
 * one explicit, commented bypass of the tenant-guard plugin — it has to look
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

// These all take organisationId and filter by it, even though the worker
// already has it from the document it just claimed. Only the claim query
// itself skips that.

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
