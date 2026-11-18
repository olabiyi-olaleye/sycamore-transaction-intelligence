import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { Account, Organisation, Transaction, User } from '../src/generated/prisma/client.js';
import type {
  Category,
  ClassificationSource,
  ClassificationStatus,
  Direction,
  ReviewStatus,
  UserRole,
} from '../src/generated/prisma/enums.js';
import { systemDb } from '../src/db/client.js';

// Shared test fixtures. They write through the system role, which isn't
// subject to row-level security, so a test can set up rows in any
// organisation directly. Everything under test goes through the API or the
// tenant-scoped repositories, where the policies do apply.

export function db() {
  return systemDb();
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}+${randomUUID()}@example.com`;
}

export function createOrganisation(name: string): Promise<Organisation> {
  // Organisation names are unique; tests create many with the same label.
  return db().organisation.create({ data: { name: `${name} ${randomUUID().slice(0, 8)}` } });
}

export async function createUser(
  organisationId: string,
  options: { email: string; password: string; name?: string; role?: UserRole },
): Promise<User> {
  const passwordHash = await argon2.hash(options.password);
  return db().user.create({
    data: {
      organisationId,
      email: options.email.toLowerCase(),
      passwordHash,
      name: options.name ?? 'Test User',
      role: options.role ?? 'member',
    },
  });
}

let accountNumber = 1000;

export function createAccount(
  organisationId: string,
  overrides: Partial<Pick<Account, 'name' | 'bankName' | 'accountNumberLast4'>> = {},
): Promise<Account> {
  accountNumber = accountNumber >= 9999 ? 1000 : accountNumber + 1;
  return db().account.create({
    data: {
      organisationId,
      name: overrides.name ?? 'Main Account',
      bankName: overrides.bankName ?? 'GTBank',
      accountNumberLast4: overrides.accountNumberLast4 ?? String(accountNumber),
      currency: 'NGN',
    },
  });
}

export interface TransactionFixtureOverrides {
  accountId: string;
  externalReference?: string;
  amountKobo: bigint;
  direction: Direction;
  narration?: string;
  merchant?: string | null;
  date: Date;
  category?: { value: Category; source: ClassificationSource; confidence: number } | null;
  reviewStatus?: ReviewStatus;
  classificationStatus?: ClassificationStatus;
  attempts?: number;
  invalidResponses?: number;
  nextAttemptAt?: Date;
  lockedUntil?: Date | null;
}

// Bypasses the import endpoint: inserts rows directly so tests can control
// dates, categories and queue state precisely.
export function createTransaction(organisationId: string, overrides: TransactionFixtureOverrides): Promise<Transaction> {
  return db().transaction.create({
    data: {
      organisationId,
      accountId: overrides.accountId,
      externalReference: overrides.externalReference ?? `fixture-${randomUUID()}`,
      amountKobo: overrides.amountKobo,
      direction: overrides.direction,
      currency: 'NGN',
      narration: overrides.narration ?? 'Fixture transaction',
      merchant: overrides.merchant ?? null,
      date: overrides.date,
      category: overrides.category?.value ?? null,
      categorySource: overrides.category?.source ?? null,
      categoryConfidence: overrides.category?.confidence ?? null,
      categoryEventId: overrides.category ? randomUUID() : null,
      classificationStatus: overrides.classificationStatus ?? 'pending',
      attempts: overrides.attempts ?? 0,
      invalidResponses: overrides.invalidResponses ?? 0,
      nextAttemptAt: overrides.nextAttemptAt ?? new Date(),
      lockedUntil: overrides.lockedUntil ?? null,
      reviewStatus: overrides.reviewStatus ?? 'none',
    },
  });
}

export function findTransaction(id: string): Promise<Transaction | null> {
  return db().transaction.findUnique({ where: { id } });
}
