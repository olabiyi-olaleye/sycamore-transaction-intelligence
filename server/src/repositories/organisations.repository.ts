import { withTenant } from '../db/tenant.js';

// Used by the unusually-large-payment detector, the one organisation setting
// the app reads.
export async function getLargePaymentMultiple(organisationId: string): Promise<number> {
  const organisation = await withTenant(organisationId, (tx) =>
    tx.organisation.findUnique({ where: { id: organisationId }, select: { largePaymentMultiple: true } }),
  );
  return organisation?.largePaymentMultiple ?? 5;
}
