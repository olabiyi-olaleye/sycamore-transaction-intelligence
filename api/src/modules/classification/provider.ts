import type { Category } from '../transactions/categories.js';
import type { Direction } from '../../db/models/transaction.model.js';

export interface ClassifyInput {
  narration: string;
  merchant: string | null;
  direction: Direction;
  amountKobo: bigint;
}

export interface ClassifyResult {
  category: Category;
  confidence: number;
  reason: string;
}

/**
 * The pluggable AI backend. Rules (rules.ts) are not a ClassificationProvider
 * — they are a deterministic pre-filter that runs before this is ever
 * called. This interface exists specifically so the AI step can be swapped
 * (mock LLM today, a real vendor later) without touching the worker or the
 * rest of the classification module; it is the one interface in the app
 * allowed to have a single implementation.
 */
export interface ClassificationProvider {
  readonly name: string;
  classify(input: ClassifyInput, signal: AbortSignal): Promise<ClassifyResult>;
}

/** Thrown by a provider whose failure carries a specific retry delay (a 429 with Retry-After). */
export class RateLimitedProviderError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'RateLimitedProviderError';
  }
}
