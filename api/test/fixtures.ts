import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { AccountModel, type AccountDocument } from '../src/db/models/account.model.js';
import { OrganisationModel, type OrganisationDocument } from '../src/db/models/organisation.model.js';
import { UserModel, type UserDocument, type UserRole } from '../src/db/models/user.model.js';

// Shared test fixtures. Every email/externalReference is suffixed with a
// fresh UUID so repeated test runs against the same persistent database never
// collide with a unique index from a previous run.
export function uniqueEmail(prefix: string): string {
  return `${prefix}+${randomUUID()}@example.com`;
}

export function createOrganisation(name: string): Promise<OrganisationDocument> {
  return OrganisationModel.create({ name });
}

export async function createUser(
  organisationId: string,
  options: { email: string; password: string; name?: string; role?: UserRole },
): Promise<UserDocument> {
  const passwordHash = await argon2.hash(options.password);
  return UserModel.create({
    organisationId,
    email: options.email,
    passwordHash,
    name: options.name ?? 'Test User',
    role: options.role ?? 'member',
  });
}

export function createAccount(
  organisationId: string,
  overrides: Partial<Pick<AccountDocument, 'name' | 'bankName' | 'accountNumberLast4' | 'currency'>> = {},
): Promise<AccountDocument> {
  return AccountModel.create({
    organisationId,
    name: overrides.name ?? 'Main Account',
    bankName: overrides.bankName ?? 'GTBank',
    accountNumberLast4: overrides.accountNumberLast4 ?? '1234',
    currency: overrides.currency ?? 'NGN',
  });
}
