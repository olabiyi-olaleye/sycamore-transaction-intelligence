import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AccountModel, type AccountDocument } from '../src/db/models/account.model.js';
import { OrganisationModel, type OrganisationDocument } from '../src/db/models/organisation.model.js';
import {
  TransactionModel,
  type Direction,
  type ReviewStatus,
  type TransactionDocument,
} from '../src/db/models/transaction.model.js';
import { UserModel, type UserDocument, type UserRole } from '../src/db/models/user.model.js';
import type { Category } from '../src/modules/transactions/categories.js';

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

export interface TransactionFixtureOverrides {
  accountId: string;
  externalReference?: string;
  amountKobo: bigint;
  direction: Direction;
  narration?: string;
  merchant?: string | null;
  date: Date;
  category?: { value: Category; source: 'rule' | 'ai' | 'human'; confidence: number } | null;
  reviewStatus?: ReviewStatus;
  classificationStatus?: 'pending' | 'processing' | 'classified' | 'failed';
  attempts?: number;
  nextAttemptAt?: Date;
  lockedUntil?: Date | null;
}

// Bypasses the import endpoint: seeds rows directly so read-API tests can
// control dates/categories/amounts precisely without going through
// classification.
export function createTransaction(
  organisationId: string,
  overrides: TransactionFixtureOverrides,
): Promise<TransactionDocument> {
  return TransactionModel.create({
    organisationId,
    accountId: overrides.accountId,
    externalReference: overrides.externalReference ?? `fixture-${randomUUID()}`,
    amountKobo: overrides.amountKobo,
    direction: overrides.direction,
    currency: 'NGN',
    narration: overrides.narration ?? 'Fixture transaction',
    merchant: overrides.merchant ?? null,
    date: overrides.date,
    category: overrides.category ? { ...overrides.category, eventId: new Types.ObjectId() } : null,
    classification: {
      status: overrides.classificationStatus ?? 'pending',
      attempts: overrides.attempts ?? 0,
      nextAttemptAt: overrides.nextAttemptAt ?? new Date(),
      lockedUntil: overrides.lockedUntil ?? null,
      lastError: null,
    },
    reviewStatus: overrides.reviewStatus ?? 'none',
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
