import mongoose from 'mongoose';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { decodeCursor, encodeCursor } from '../transactions/cursor.js';
import type { ReviewFlagDocument } from '../../db/models/reviewFlag.model.js';
import { findFlagById, listFlags, resolveFlag } from './review.repository.js';
import type { ListFlagsQuery } from './review.schema.js';

export interface ReviewFlagView {
  id: string;
  transactionId: string;
  type: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

function toView(flag: ReviewFlagDocument): ReviewFlagView {
  return {
    id: flag._id.toString(),
    transactionId: flag.transactionId.toString(),
    type: flag.type,
    reason: flag.reason,
    status: flag.status,
    createdAt: flag.createdAt.toISOString(),
    resolvedAt: flag.resolvedAt ? flag.resolvedAt.toISOString() : null,
  };
}

export interface ReviewFlagListView {
  flags: ReviewFlagView[];
  nextCursor: string | null;
}

export async function listFlagsView(organisationId: string, query: ListFlagsQuery): Promise<ReviewFlagListView> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const { flags, hasMore } = await listFlags(organisationId, { status: query.status, cursor, limit: query.limit });
  const last = flags[flags.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ date: last.createdAt, id: last._id.toString() }) : null;
  return { flags: flags.map(toView), nextCursor };
}

export async function resolveFlagView(organisationId: string, flagId: string, resolvedByUserId: string): Promise<ReviewFlagView> {
  if (!mongoose.isValidObjectId(flagId)) {
    throw new NotFoundError('Flag not found');
  }
  const resolved = await resolveFlag(organisationId, flagId, resolvedByUserId);
  if (resolved) {
    return toView(resolved);
  }

  // resolveFlag only matches a still-open flag, so null means either it
  // doesn't exist (or isn't this organisation's) or it was resolved already.
  const existing = await findFlagById(organisationId, flagId);
  if (!existing) {
    throw new NotFoundError('Flag not found');
  }
  throw new ConflictError('Flag is already resolved');
}
