import type { Prisma } from '../generated/prisma/client.js';
import { appDb } from './client.js';

export type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Runs fn in a transaction scoped to one organisation. set_config(..., true)
 * lasts only until the transaction ends, so the setting can't leak to the
 * next request that gets the same pooled connection. Row-level security
 * then filters every tenant table to this organisation, whatever the query
 * says. The repositories still filter by organisationId explicitly as well;
 * the policy is there in case one of them ever doesn't.
 */
export async function withTenant<T>(organisationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(organisationId)) {
    throw new Error(`withTenant called with an invalid organisation id: ${organisationId}`);
  }
  return appDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organisation_id', ${organisationId}, true)`;
    return fn(tx);
  });
}
