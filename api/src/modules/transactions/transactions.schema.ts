import { z } from 'zod';
import { AMOUNT_PATTERN, parseAmountToKobo } from '../../money/money.js';
import { CATEGORIES } from './categories.js';

// Only calls parseAmountToKobo to validate, never to do arithmetic. The
// actual parsing stays in money.ts.
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

// Just checks the envelope is an array of a plausible size. Rows are
// validated one at a time in transactions.service.ts, so a bad row shows up
// as that row's own "failed" result instead of a 400 for the whole batch.
export const batchEnvelopeSchema = z.object({
  transactions: z.array(z.unknown()).min(1, 'a batch must contain at least one row').max(1000, 'a batch may contain at most 1000 rows'),
});

const filterAmountSchema = z.string().regex(AMOUNT_PATTERN, 'must match ^\\d+(\\.\\d{1,2})?$');

export const listTransactionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  accountId: z.string().optional(),
  direction: z.enum(['credit', 'debit']).optional(),
  category: z.enum(CATEGORIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minAmount: filterAmountSchema.optional(),
  maxAmount: filterAmountSchema.optional(),
  reviewStatus: z.enum(['none', 'open', 'resolved']).optional(),
  q: z.string().min(1).optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const correctionSchema = z.object({
  category: z.enum(CATEGORIES),
  note: z.string().min(1).optional(),
});

export type CorrectionInput = z.infer<typeof correctionSchema>;
