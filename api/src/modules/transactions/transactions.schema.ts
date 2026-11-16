import { z } from 'zod';
import { AMOUNT_PATTERN, parseAmountToKobo } from '../../money/money.js';

// The only place outside money.ts that even mentions amount parsing, and it
// only calls parseAmountToKobo to validate — it never does arithmetic on the
// string itself.
export const amountSchema = z
  .string({
    error:
      'amount must be a decimal string like "12999.75" — JSON numbers are rejected because money is only ever parsed as bigint kobo, never as a float',
  })
  .regex(AMOUNT_PATTERN, 'amount must match ^\\d+(\\.\\d{1,2})?$ (at most two decimal places, no sign)')
  .refine((value) => {
    try {
      return parseAmountToKobo(value) > 0n;
    } catch {
      return false;
    }
  }, 'amount must be greater than zero');

export const importTransactionSchema = z.object({
  accountId: z.string().min(1, 'accountId is required'),
  externalReference: z.string().min(1, 'externalReference is required'),
  amount: amountSchema,
  direction: z.enum(['credit', 'debit']),
  currency: z.literal('NGN', { error: 'currency must be "NGN" — this prototype only supports Nigerian Naira' }),
  narration: z.string().min(1, 'narration is required'),
  merchant: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? null),
  date: z.coerce.date({ error: 'date must be a valid date' }),
});

export type ImportTransactionInput = z.infer<typeof importTransactionSchema>;

// Deliberately loose: the envelope just needs to be an array of plausible
// size. Each row is validated individually inside transactions.service.ts so
// one malformed row becomes a per-row "failed" result, not a 400 for the
// whole batch.
export const batchEnvelopeSchema = z.object({
  transactions: z.array(z.unknown()).min(1, 'a batch must contain at least one row').max(1000, 'a batch may contain at most 1000 rows'),
});
