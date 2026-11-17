import mongoose from 'mongoose';
import { findAccountById } from '../accounts/accounts.repository.js';
import { listEventsForTransaction } from '../classification/classification.repository.js';
import { listFlagsForTransaction } from '../review/review.repository.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { formatKoboAsAmount, parseAmountToKobo, parseFilterAmountToKobo } from '../../money/money.js';
import type { TransactionDocument } from '../../db/models/transaction.model.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import {
  findById,
  findByReference,
  insertManyTransactions,
  insertTransaction,
  listTransactions as listTransactionsRepo,
  type NewTransactionInput,
} from './transactions.repository.js';
import {
  importTransactionSchema,
  type ImportTransactionInput,
  type ListTransactionsQuery,
} from './transactions.schema.js';

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

export interface TransactionListView {
  transactions: TransactionView[];
  nextCursor: string | null;
}

export async function listTransactionsView(
  organisationId: string,
  query: ListTransactionsQuery,
): Promise<TransactionListView> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const minAmountKobo = query.minAmount !== undefined ? parseFilterAmountToKobo(query.minAmount) : undefined;
  const maxAmountKobo = query.maxAmount !== undefined ? parseFilterAmountToKobo(query.maxAmount) : undefined;

  const { transactions, hasMore } = await listTransactionsRepo(organisationId, {
    accountId: query.accountId,
    direction: query.direction,
    category: query.category,
    from: query.from,
    to: query.to,
    minAmountKobo,
    maxAmountKobo,
    reviewStatus: query.reviewStatus,
    q: query.q,
    cursor,
    limit: query.limit,
  });

  const last = transactions[transactions.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ date: last.date, id: last._id.toString() }) : null;

  return { transactions: transactions.map(toView), nextCursor };
}

export interface ClassificationHistoryEntry {
  source: string;
  provider: string;
  category: string;
  previousCategory: string | null;
  confidence: number | null;
  reason: string;
  actorUserId: string | null;
  note: string | null;
  createdAt: string;
}

export interface TransactionFlagView {
  id: string;
  type: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface TransactionDetailView extends TransactionView {
  classificationHistory: ClassificationHistoryEntry[];
  flags: TransactionFlagView[];
}

export async function getTransactionDetail(organisationId: string, transactionId: string): Promise<TransactionDetailView> {
  if (!mongoose.isValidObjectId(transactionId)) {
    throw new NotFoundError('Transaction not found');
  }
  const transaction = await findById(organisationId, transactionId);
  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }

  const [events, flags] = await Promise.all([
    listEventsForTransaction(organisationId, transactionId),
    listFlagsForTransaction(organisationId, transactionId),
  ]);

  return {
    ...toView(transaction),
    classificationHistory: events.map((event) => ({
      source: event.source,
      provider: event.provider,
      category: event.category,
      previousCategory: event.previousCategory,
      confidence: event.confidence,
      reason: event.reason,
      actorUserId: event.actorUserId ? event.actorUserId.toString() : null,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
    flags: flags.map((flag) => ({
      id: flag._id.toString(),
      type: flag.type,
      reason: flag.reason,
      status: flag.status,
      createdAt: flag.createdAt.toISOString(),
      resolvedAt: flag.resolvedAt ? flag.resolvedAt.toISOString() : null,
    })),
  };
}
