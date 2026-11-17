import { TransactionModel, type TransactionDocument } from '../../db/models/transaction.model.js';
import { formatNaira } from '../../money/money.js';
import { createFlag, getLargePaymentMultiple } from './review.repository.js';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_PRIOR_DEBITS = 10;

function hoursApartPhrase(transactionDate: Date, candidateDate: Date): string {
  const deltaMs = transactionDate.getTime() - candidateDate.getTime();
  const hours = Math.max(1, Math.round(Math.abs(deltaMs) / 3_600_000));
  return deltaMs >= 0 ? `${hours} hour${hours === 1 ? '' : 's'} earlier` : `${hours} hour${hours === 1 ? '' : 's'} later`;
}

/** Same account, direction and amount, a different reference, within 24 hours either side. */
export async function detectPossibleDuplicate(organisationId: string, transaction: TransactionDocument): Promise<void> {
  const windowStart = new Date(transaction.date.getTime() - DUPLICATE_WINDOW_MS);
  const windowEnd = new Date(transaction.date.getTime() + DUPLICATE_WINDOW_MS);

  const candidate = await TransactionModel.findOne({
    organisationId,
    accountId: transaction.accountId,
    direction: transaction.direction,
    amountKobo: transaction.amountKobo,
    externalReference: { $ne: transaction.externalReference },
    date: { $gte: windowStart, $lte: windowEnd },
    _id: { $ne: transaction._id },
  }).lean();

  if (!candidate) return;

  await createFlag(organisationId, {
    transactionId: transaction._id.toString(),
    type: 'POSSIBLE_DUPLICATE',
    reason: `Same amount (${formatNaira(transaction.amountKobo)}) was paid from this account ${hoursApartPhrase(transaction.date, candidate.date)} under reference ${candidate.externalReference}.`,
    details: { duplicateOfTransactionId: candidate._id.toString() },
  });
}

/** A debit above largePaymentMultiple x the account's median debit over the last 90 days, with at least 10 prior debits. */
export async function detectUnusuallyLarge(organisationId: string, transaction: TransactionDocument): Promise<void> {
  if (transaction.direction !== 'debit') return;

  const since = new Date(transaction.date.getTime() - NINETY_DAYS_MS);
  const priorDebits = await TransactionModel.find({
    organisationId,
    accountId: transaction.accountId,
    direction: 'debit',
    date: { $gte: since, $lte: transaction.date },
    _id: { $ne: transaction._id },
  })
    .select('amountKobo')
    .lean();

  if (priorDebits.length < MIN_PRIOR_DEBITS) return;

  const amounts = priorDebits.map((doc) => doc.amountKobo).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 === 0 ? (amounts[mid - 1]! + amounts[mid]!) / 2n : amounts[mid]!;
  if (median <= 0n) return;

  const multiplier = await getLargePaymentMultiple(organisationId);
  if (transaction.amountKobo <= median * BigInt(multiplier)) return;

  const multiple = transaction.amountKobo / median; // bigint division, so no float touches the money here
  await createFlag(organisationId, {
    transactionId: transaction._id.toString(),
    type: 'UNUSUALLY_LARGE',
    reason: `${formatNaira(transaction.amountKobo)} is ${multiple}x this account's typical debit of ${formatNaira(median)}.`,
    details: { medianDebitKobo: median.toString(), multiplier },
  });
}

export async function runDetectors(organisationId: string, transaction: TransactionDocument): Promise<void> {
  await detectPossibleDuplicate(organisationId, transaction);
  await detectUnusuallyLarge(organisationId, transaction);
}
