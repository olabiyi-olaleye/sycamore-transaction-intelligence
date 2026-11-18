import type { User } from '../generated/prisma/client.js';
import { systemDb } from '../db/client.js';
import { withTenant } from '../db/tenant.js';

export type { User };

/**
 * Login looks a user up by email before anyone knows which organisation
 * they belong to, which row-level security would (rightly) refuse. So this
 * one read runs as sycamore_system. Emails are stored lower-cased (a CHECK
 * constraint enforces it).
 */
export function findUserByEmail(email: string): Promise<User | null> {
  return systemDb().user.findUnique({ where: { email: email.toLowerCase() } });
}

export function findUserById(organisationId: string, userId: string): Promise<User | null> {
  return withTenant(organisationId, (tx) => tx.user.findFirst({ where: { organisationId, id: userId } }));
}
