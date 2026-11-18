import type { ClassificationEvent } from '../generated/prisma/client.js';
import type { Category, ClassificationSource } from '../generated/prisma/enums.js';
import { withTenant } from '../db/tenant.js';

export type { ClassificationEvent };

// Insert and read only. The table has a trigger that rejects UPDATE and
// DELETE, so the history can't be edited even by mistake.
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

export function insertEvent(organisationId: string, event: NewClassificationEvent): Promise<ClassificationEvent> {
  return withTenant(organisationId, (tx) =>
    tx.classificationEvent.create({
      data: {
        organisationId,
        transactionId: event.transactionId,
        source: event.source,
        provider: event.provider,
        category: event.category,
        previousCategory: event.previousCategory,
        confidence: event.confidence,
        reason: event.reason,
        actorUserId: event.actorUserId ?? null,
        note: event.note ?? null,
      },
    }),
  );
}

export function listEventsForTransaction(organisationId: string, transactionId: string): Promise<ClassificationEvent[]> {
  return withTenant(organisationId, (tx) =>
    tx.classificationEvent.findMany({ where: { organisationId, transactionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  );
}
