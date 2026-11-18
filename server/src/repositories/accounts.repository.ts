import type { Account } from '../generated/prisma/client.js';
import { withTenant } from '../db/tenant.js';

export type { Account };

export function listAccounts(organisationId: string): Promise<Account[]> {
  return withTenant(organisationId, (tx) => tx.account.findMany({ where: { organisationId }, orderBy: { name: 'asc' } }));
}

export function findAccountById(organisationId: string, accountId: string): Promise<Account | null> {
  return withTenant(organisationId, (tx) => tx.account.findFirst({ where: { organisationId, id: accountId } }));
}
