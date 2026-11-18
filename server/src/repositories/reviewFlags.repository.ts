import type { Prisma, ReviewFlag } from '../generated/prisma/client.js';
import type { ReviewFlagStatus, ReviewFlagType, ReviewStatus } from '../generated/prisma/enums.js';
import { withTenant, type Tx } from '../db/tenant.js';
import type { ListCursor } from '../utils/cursor.js';

export type { ReviewFlag, ReviewFlagType };

/**
 * Recomputes transaction.review_status from its flags: 'open' while any flag
 * is open, 'resolved' once every flag is resolved, 'none' if it never had
 * one. Called inside the same transaction as the flag change, so the two
 * never disagree.
 */
async function syncReviewStatus(tx: Tx, organisationId: string, transactionId: string): Promise<ReviewStatus> {
  const openCount = await tx.reviewFlag.count({ where: { organisationId, transactionId, status: 'open' } });
  const totalCount = await tx.reviewFlag.count({ where: { organisationId, transactionId } });
  const reviewStatus: ReviewStatus = openCount > 0 ? 'open' : totalCount > 0 ? 'resolved' : 'none';
  await tx.transaction.updateMany({ where: { organisationId, id: transactionId }, data: { reviewStatus } });
  return reviewStatus;
}

export interface CreateFlagInput {
  transactionId: string;
  type: ReviewFlagType;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Idempotent through the unique (transaction_id, type) constraint: a
 * detector that runs twice over the same transaction raises the flag once.
 */
export async function createFlag(organisationId: string, input: CreateFlagInput): Promise<void> {
  await withTenant(organisationId, async (tx) => {
    await tx.reviewFlag.createMany({
      data: [
        {
          organisationId,
          transactionId: input.transactionId,
          type: input.type,
          reason: input.reason,
          details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      ],
      skipDuplicates: true,
    });
    await syncReviewStatus(tx, organisationId, input.transactionId);
  });
}

export function listFlagsForTransaction(organisationId: string, transactionId: string): Promise<ReviewFlag[]> {
  return withTenant(organisationId, (tx) =>
    tx.reviewFlag.findMany({ where: { organisationId, transactionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  );
}

export interface ListFlagsFilters {
  status?: ReviewFlagStatus;
  cursor?: ListCursor;
  limit: number;
}

export async function listFlags(organisationId: string, filters: ListFlagsFilters): Promise<{ flags: ReviewFlag[]; hasMore: boolean }> {
  const and: Prisma.ReviewFlagWhereInput[] = [{ organisationId }];
  if (filters.status) and.push({ status: filters.status });
  if (filters.cursor) {
    and.push({
      OR: [{ createdAt: { lt: filters.cursor.date } }, { createdAt: filters.cursor.date, id: { lt: filters.cursor.id } }],
    });
  }

  const rows = await withTenant(organisationId, (tx) =>
    tx.reviewFlag.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: filters.limit + 1 }),
  );
  const hasMore = rows.length > filters.limit;
  return { flags: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
}

export function findFlagById(organisationId: string, flagId: string): Promise<ReviewFlag | null> {
  return withTenant(organisationId, (tx) => tx.reviewFlag.findFirst({ where: { organisationId, id: flagId } }));
}

/** Resolves only if still open, so resolving twice is a no-op the caller can detect (null back). */
export function resolveFlag(organisationId: string, flagId: string, resolvedBy: string): Promise<ReviewFlag | null> {
  return withTenant(organisationId, async (tx) => {
    const { count } = await tx.reviewFlag.updateMany({
      where: { organisationId, id: flagId, status: 'open' },
      data: { status: 'resolved', resolvedBy, resolvedAt: new Date() },
    });
    if (count === 0) return null;
    const resolved = await tx.reviewFlag.findFirst({ where: { organisationId, id: flagId } });
    if (resolved) await syncReviewStatus(tx, organisationId, resolved.transactionId);
    return resolved;
  });
}

/**
 * Resolves the given flag types on one transaction. Called from a manual
 * correction (resolvedBy is the user) and when the worker classifies a
 * transaction that had previously failed (resolvedBy is null: the system).
 */
export async function resolveOpenFlagsForTransaction(
  organisationId: string,
  transactionId: string,
  types: ReviewFlagType[],
  resolvedBy: string | null,
): Promise<void> {
  await withTenant(organisationId, async (tx) => {
    const { count } = await tx.reviewFlag.updateMany({
      where: { organisationId, transactionId, type: { in: types }, status: 'open' },
      data: { status: 'resolved', resolvedBy, resolvedAt: new Date() },
    });
    // The worker calls this after every successful classification, so skip
    // the extra reads when nothing changed.
    if (count > 0) await syncReviewStatus(tx, organisationId, transactionId);
  });
}

export function countOpenFlags(organisationId: string): Promise<number> {
  return withTenant(organisationId, (tx) => tx.reviewFlag.count({ where: { organisationId, status: 'open' } }));
}
