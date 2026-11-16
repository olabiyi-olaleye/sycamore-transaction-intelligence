import { findAccountById } from '../accounts/accounts.repository.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { formatKoboAsAmount, parseAmountToKobo } from '../../money/money.js';
import type { TransactionDocument } from '../../db/models/transaction.model.js';
import {
  findByReference,
  insertManyTransactions,
  insertTransaction,
  type NewTransactionInput,
} from './transactions.repository.js';
import { importTransactionSchema, type ImportTransactionInput } from './transactions.schema.js';

export interface TransactionView {
  id: string;
  accountId: string;
  externalReference: string;
  amount: string;
  direction: string;
  currency: string;
  narration: string;
  merchant: string | null;
  date: string;
  category: { value: string; source: string; confidence: number } | null;
  classification: { status: string; attempts: number; lastError: string | null };
  reviewStatus: string;
}

export function toView(tx: TransactionDocument): TransactionView {
  return {
    id: tx._id.toString(),
    accountId: tx.accountId.toString(),
    externalReference: tx.externalReference,
    amount: formatKoboAsAmount(tx.amountKobo),
    direction: tx.direction,
    currency: tx.currency,
    narration: tx.narration,
    merchant: tx.merchant,
    date: tx.date.toISOString(),
    category: tx.category ? { value: tx.category.value, source: tx.category.source, confidence: tx.category.confidence } : null,
    classification: {
      status: tx.classification.status,
      attempts: tx.classification.attempts,
      lastError: tx.classification.lastError,
    },
    reviewStatus: tx.reviewStatus,
  };
}

function toNewTransactionInput(organisationId: string, input: ImportTransactionInput): NewTransactionInput {
  return {
    organisationId,
    accountId: input.accountId,
    externalReference: input.externalReference,
    amountKobo: parseAmountToKobo(input.amount),
    direction: input.direction,
    currency: input.currency,
    narration: input.narration,
    merchant: input.merchant,
    date: input.date,
  };
}

function sameTransaction(existing: TransactionDocument, candidate: NewTransactionInput): boolean {
  return (
    existing.amountKobo === candidate.amountKobo &&
    existing.direction === candidate.direction &&
    existing.currency === candidate.currency &&
    existing.narration === candidate.narration &&
    existing.merchant === candidate.merchant &&
    existing.date.getTime() === candidate.date.getTime()
  );
}

export interface ImportOutcome {
  status: 'created' | 'duplicate';
  transaction: TransactionView;
}

export async function importTransaction(organisationId: string, input: ImportTransactionInput): Promise<ImportOutcome> {
  const account = await findAccountById(organisationId, input.accountId);
  if (!account) {
    throw new NotFoundError('Account not found');
  }

  const candidate = toNewTransactionInput(organisationId, input);
  const result = await insertTransaction(candidate);
  if (result.outcome === 'inserted') {
    return { status: 'created', transaction: toView(result.document) };
  }

  const existing = await findByReference(organisationId, input.accountId, input.externalReference);
  if (!existing) {
    throw new ConflictError('Could not resolve the existing transaction for this reference; retry the request');
  }
  if (sameTransaction(existing, candidate)) {
    return { status: 'duplicate', transaction: toView(existing) };
  }
  throw new ConflictError('A transaction with this external reference already exists with different details', {
    existing: toView(existing),
  });
}

export interface BatchRowResult {
  index: number;
  status: 'created' | 'duplicate' | 'failed';
  transactionId?: string;
  error?: string;
}

export interface BatchResult {
  results: BatchRowResult[];
  summary: { created: number; duplicate: number; failed: number };
}

export async function importBatch(organisationId: string, rawRows: unknown[]): Promise<BatchResult> {
  const results: BatchRowResult[] = new Array(rawRows.length);
  const candidates: Array<{ index: number; input: NewTransactionInput }> = [];
  const seenKeys = new Map<string, number>();
  const accountOwnership = new Map<string, boolean>();

  for (let index = 0; index < rawRows.length; index += 1) {
    const parsed = importTransactionSchema.safeParse(rawRows[index]);
    if (!parsed.success) {
      results[index] = {
        index,
        status: 'failed',
        error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`).join('; '),
      };
      continue;
    }

    const row = parsed.data;
    let ownsAccount = accountOwnership.get(row.accountId);
    if (ownsAccount === undefined) {
      const account = await findAccountById(organisationId, row.accountId);
      ownsAccount = Boolean(account);
      accountOwnership.set(row.accountId, ownsAccount);
    }
    if (!ownsAccount) {
      results[index] = { index, status: 'failed', error: 'Account not found' };
      continue;
    }

    const key = `${row.accountId}:${row.externalReference}`;
    const firstSeenAt = seenKeys.get(key);
    if (firstSeenAt !== undefined) {
      results[index] = { index, status: 'duplicate', error: `Repeats row ${firstSeenAt} in this batch` };
      continue;
    }
    seenKeys.set(key, index);
    candidates.push({ index, input: toNewTransactionInput(organisationId, row) });
  }

  const outcome = await insertManyTransactions(candidates.map((candidate) => candidate.input));

  for (const { position, document } of outcome.inserted) {
    const candidate = candidates[position];
    if (!candidate) continue;
    results[candidate.index] = { index: candidate.index, status: 'created', transactionId: document._id.toString() };
  }
  for (const position of outcome.duplicatePositions) {
    const candidate = candidates[position];
    if (!candidate) continue;
    results[candidate.index] = {
      index: candidate.index,
      status: 'duplicate',
      error: 'externalReference already exists for this account',
    };
  }

  const summary = { created: 0, duplicate: 0, failed: 0 };
  for (const row of results) {
    summary[row.status] += 1;
  }

  return { results, summary };
}
