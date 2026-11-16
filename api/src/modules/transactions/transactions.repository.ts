import { TransactionModel, type Direction, type TransactionDocument } from '../../db/models/transaction.model.js';

export interface NewTransactionInput {
  organisationId: string;
  accountId: string;
  externalReference: string;
  amountKobo: bigint;
  direction: Direction;
  currency: 'NGN';
  narration: string;
  merchant: string | null;
  date: Date;
}

interface MongoWriteError {
  index: number;
  code?: number;
  errmsg?: string;
  err?: { code?: number; errmsg?: string };
}

interface MongoBulkWriteError {
  writeErrors?: MongoWriteError[];
  insertedDocs?: unknown[];
}

function errorCode(error: unknown): number | undefined {
  return (error as { code?: number } | undefined)?.code;
}

function isDuplicateKeyError(error: unknown): boolean {
  return errorCode(error) === 11000;
}

function isBulkWriteError(error: unknown): error is MongoBulkWriteError {
  return typeof error === 'object' && error !== null && 'writeErrors' in error;
}

export type InsertResult = { outcome: 'inserted'; document: TransactionDocument } | { outcome: 'duplicate' };

/**
 * Always attempts the insert; never checks existence first. The unique index
 * on (organisationId, accountId, externalReference) is what decides a
 * duplicate, so under concurrent identical requests exactly one insert wins
 * and the rest learn about it from this error, not from a prior read.
 */
export async function insertTransaction(input: NewTransactionInput): Promise<InsertResult> {
  try {
    const doc = await TransactionModel.create(input);
    return { outcome: 'inserted', document: doc.toObject() };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { outcome: 'duplicate' };
    }
    throw error;
  }
}

export function findByReference(
  organisationId: string,
  accountId: string,
  externalReference: string,
): Promise<TransactionDocument | null> {
  return TransactionModel.findOne({ organisationId, accountId, externalReference }).lean();
}

export function findById(organisationId: string, transactionId: string): Promise<TransactionDocument | null> {
  return TransactionModel.findOne({ organisationId, _id: transactionId }).lean();
}

export interface BatchInsertOutcome {
  inserted: Array<{ position: number; document: TransactionDocument }>;
  duplicatePositions: number[];
}

/**
 * `ordered: false` so one bad row never blocks the rest. On a partial
 * failure the driver throws rather than returning a result, so the success
 * list has to be read back out of the error. This is the only place in the
 * app that reads that error shape.
 */
export async function insertManyTransactions(docs: NewTransactionInput[]): Promise<BatchInsertOutcome> {
  if (docs.length === 0) {
    return { inserted: [], duplicatePositions: [] };
  }

  try {
    const created = await TransactionModel.insertMany(docs, { ordered: false });
    return {
      inserted: created.map((document, position) => ({ position, document: document.toObject() })),
      duplicatePositions: [],
    };
  } catch (error) {
    if (!isBulkWriteError(error)) {
      throw error;
    }

    const writeErrors = error.writeErrors ?? [];
    const failedPositions = new Set(writeErrors.map((writeError) => writeError.index));
    const unexpectedFailures = writeErrors.filter(
      (writeError) => (writeError.err?.code ?? writeError.code) !== 11000,
    );
    if (unexpectedFailures.length > 0) {
      throw new Error(
        `Unexpected batch insert failure (not a duplicate key): ${JSON.stringify(unexpectedFailures)}`,
      );
    }

    const insertedPositions = docs.map((_, position) => position).filter((position) => !failedPositions.has(position));
    const insertedDocs = (error.insertedDocs ?? []) as Array<{ toObject?: () => TransactionDocument } & TransactionDocument>;

    return {
      inserted: insertedPositions.map((position, order) => {
        const doc = insertedDocs[order] as { toObject?: () => TransactionDocument } & TransactionDocument;
        return { position, document: doc.toObject ? doc.toObject() : doc };
      }),
      duplicatePositions: [...failedPositions],
    };
  }
}
