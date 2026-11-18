import { formatNaira } from '../../utils/money.js';
import { createFlag } from '../../repositories/reviewFlags.repository.js';
import { getLargePaymentMultiple } from '../../repositories/organisations.repository.js';
import {
  debitStats,
  findSameAmountNearby,
  hasSimilarDebitBetween,
  type Transaction,
} from '../../repositories/transactions.repository.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_PRIOR_DEBITS = 10;

// "3 hours earlier" / "2 hours later". Bank exports often carry a date with
// no time, so two payments on the same day can have identical timestamps;
// those read "on the same date" rather than a made-up "1 hour earlier".
function hoursApartPhrase(transactionDate: Date, candidateDate: Date): string {
  const deltaMs = transactionDate.getTime() - candidateDate.getTime();
  const hours = Math.round(Math.abs(deltaMs) / HOUR_MS);
  if (hours === 0) return 'on the same date';
  return `${hours} hour${hours === 1 ? '' : 's'} ${deltaMs > 0 ? 'earlier' : 'later'}`;
}

/** Same account, direction and amount, a different reference, within 24 hours either side. */
export async function detectPossibleDuplicate(organisationId: string, transaction: Transaction): Promise<void> {
  const candidate = await findSameAmountNearby(
    organisationId,
    transaction,
    new Date(transaction.date.getTime() - DAY_MS),
    new Date(transaction.date.getTime() + DAY_MS),
  );
  if (!candidate) return;

  await createFlag(organisationId, {
    transactionId: transaction.id,
    type: 'POSSIBLE_DUPLICATE',
    reason: `Same amount (${formatNaira(transaction.amountKobo)}) was paid from this account ${hoursApartPhrase(transaction.date, candidate.date)} under reference ${candidate.externalReference}.`,
    details: { duplicateOfTransactionId: candidate.id },
  });
}

/**
 * A similar debit (within 5%) on the same account 20-40 days earlier means
 * this is a monthly payment the business already makes (salaries, a payroll
 * top-up, rent), so it isn't "unusual" however large it is next to the
 * account's everyday spending.
 */
function isRecurringMonthly(organisationId: string, transaction: Transaction): Promise<boolean> {
  return hasSimilarDebitBetween(
    organisationId,
    transaction,
    (transaction.amountKobo * 95n) / 100n,
    (transaction.amountKobo * 105n) / 100n,
    new Date(transaction.date.getTime() - 40 * DAY_MS),
    new Date(transaction.date.getTime() - 20 * DAY_MS),
  );
}

/**
 * A debit above largePaymentMultiple x the account's median debit over the
 * last 90 days, with at least 10 prior debits, that isn't a recurring
 * monthly payment. The count and median are computed in the database.
 */
export async function detectUnusuallyLarge(organisationId: string, transaction: Transaction): Promise<void> {
  if (transaction.direction !== 'debit') return;

  const { count, medianKobo } = await debitStats(organisationId, transaction, new Date(transaction.date.getTime() - 90 * DAY_MS));
  if (count < MIN_PRIOR_DEBITS || medianKobo === null || medianKobo <= 0n) return;

  const multiplier = await getLargePaymentMultiple(organisationId);
  if (transaction.amountKobo <= medianKobo * BigInt(multiplier)) return;
  if (await isRecurringMonthly(organisationId, transaction)) return;

  const multiple = transaction.amountKobo / medianKobo; // bigint division, so no float touches the money here
  await createFlag(organisationId, {
    transactionId: transaction.id,
    type: 'UNUSUALLY_LARGE',
    reason: `${formatNaira(transaction.amountKobo)} is ${multiple}x this account's typical debit of ${formatNaira(medianKobo)}.`,
    details: { medianDebitKobo: medianKobo.toString(), multiplier },
  });
}

export async function runDetectors(organisationId: string, transaction: Transaction): Promise<void> {
  await detectPossibleDuplicate(organisationId, transaction);
  await detectUnusuallyLarge(organisationId, transaction);
}
