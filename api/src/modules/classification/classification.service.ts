import { config } from '../../config/env.js';
import { categoryLabel } from '../transactions/categories.js';
import { createFlag } from '../review/review.repository.js';
import { runDetectors } from '../review/detectors.js';
import type { TransactionDocument } from '../../db/models/transaction.model.js';
import { classifyResultSchema } from './classification.schema.js';
import { mockLlmProvider } from './mockLlmProvider.js';
import { RateLimitedProviderError, type ClassifyInput, type ClassifyResult } from './provider.js';
import { classifyWithRules } from './rules.js';
import {
  applyCorrection,
  claimNextTransaction,
  insertEvent,
  markClassified,
  markFailed,
  scheduleRetry,
} from './classification.repository.js';
import { resolveOpenFlagsForTransaction } from '../review/review.repository.js';
import type { Category } from '../transactions/categories.js';

// "Automatic categorisation failed after 5 attempts" (build plan's
// CLASSIFICATION_FAILED example) fixes this at 5.
const MAX_ATTEMPTS = 5;
const PROVIDER_TIMEOUT_MS = 5000;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// Circuit breaker: after this many consecutive LLM failures, skip calling
// the provider for a cool-off and reschedule immediately instead — rules
// keep running throughout. In-memory and process-global: correct for a
// single worker process, and the first thing cut if time runs short.
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLOFF_MS = 30_000;

let consecutiveLlmFailures = 0;
let circuitOpenUntil: number | null = null;

/** Test-only: the breaker's cooldown is otherwise indistinguishable from a real 30s outage. */
export function resetCircuitBreakerForTests(): void {
  consecutiveLlmFailures = 0;
  circuitOpenUntil = null;
}

function isCircuitOpen(): boolean {
  return circuitOpenUntil !== null && Date.now() < circuitOpenUntil;
}

function recordLlmSuccess(): void {
  consecutiveLlmFailures = 0;
  circuitOpenUntil = null;
}

function recordLlmFailure(): void {
  consecutiveLlmFailures += 1;
  if (consecutiveLlmFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLOFF_MS;
  }
}

function backoffWithJitter(attempts: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  const jitter = Math.random() * exponential * 0.25;
  return Math.round(exponential + jitter);
}

async function callProviderWithTimeout(input: ClassifyInput): Promise<ClassifyResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const raw = await mockLlmProvider.classify(input, controller.signal);
    const parsed = classifyResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Provider returned a malformed result: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function finishClassification(
  organisationId: string,
  transactionId: string,
  result: ClassifyResult,
  source: 'rule' | 'ai',
  provider: string,
): Promise<void> {
  const event = await insertEvent(organisationId, {
    transactionId,
    source,
    provider,
    category: result.category,
    previousCategory: null,
    confidence: result.confidence,
    reason: result.reason,
  });
  await markClassified(organisationId, transactionId, result.category, source, result.confidence, event._id.toString());

  if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
    await createFlag(organisationId, {
      transactionId,
      type: 'LOW_CONFIDENCE',
      reason: `Categorised as ${categoryLabel(result.category)} with ${Math.round(result.confidence * 100)}% confidence.`,
    });
  }
}

async function handleFailure(
  organisationId: string,
  transactionId: string,
  attempts: number,
  errorMessage: string,
  retryAfterMs: number | undefined,
): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await markFailed(organisationId, transactionId, errorMessage);
    await createFlag(organisationId, {
      transactionId,
      type: 'CLASSIFICATION_FAILED',
      reason: `Automatic categorisation failed after ${MAX_ATTEMPTS} attempts.`,
    });
    return;
  }
  const delayMs = retryAfterMs ?? backoffWithJitter(attempts);
  await scheduleRetry(organisationId, transactionId, errorMessage, new Date(Date.now() + delayMs));
}

async function classifyTransaction(transaction: TransactionDocument): Promise<void> {
  const organisationId = transaction.organisationId.toString();
  const transactionId = transaction._id.toString();
  const input: ClassifyInput = {
    narration: transaction.narration,
    merchant: transaction.merchant,
    direction: transaction.direction,
    amountKobo: transaction.amountKobo,
  };

  const ruleResult = classifyWithRules(input);
  if (ruleResult) {
    await finishClassification(organisationId, transactionId, ruleResult, 'rule', 'rules-engine');
    return;
  }

  if (isCircuitOpen()) {
    await handleFailure(organisationId, transactionId, transaction.classification.attempts, 'LLM circuit breaker open; skipped call', undefined);
    return;
  }

  try {
    const result = await callProviderWithTimeout(input);
    recordLlmSuccess();
    await finishClassification(organisationId, transactionId, result, 'ai', mockLlmProvider.name);
  } catch (error) {
    recordLlmFailure();
    const retryAfterMs = error instanceof RateLimitedProviderError ? error.retryAfterMs : undefined;
    await handleFailure(organisationId, transactionId, transaction.classification.attempts, (error as Error).message, retryAfterMs);
  }
}

/**
 * A manual correction: writes the event and updates the transaction in one
 * multi-document transaction (classification.repository.ts), then resolves
 * any LOW_CONFIDENCE or CLASSIFICATION_FAILED flag on it — a human has just
 * done what those flags were asking for.
 */
export async function correctClassification(
  organisationId: string,
  transactionId: string,
  previousCategory: Category | null,
  actorUserId: string,
  newCategory: Category,
  note: string | undefined,
): Promise<void> {
  await applyCorrection(organisationId, transactionId, previousCategory, newCategory, actorUserId, note);
  await resolveOpenFlagsForTransaction(organisationId, transactionId, ['LOW_CONFIDENCE', 'CLASSIFICATION_FAILED'], actorUserId);
}

/** Claims and classifies one transaction. Called in a loop by the worker. */
export async function processOneClaimedTransaction(): Promise<'claimed' | 'empty'> {
  const transaction = await claimNextTransaction(config.WORKER_LOCK_MS);
  if (!transaction) {
    return 'empty';
  }
  await classifyTransaction(transaction);
  // Duplicate/large-payment detection is about the raw transaction, not its
  // category, so it runs regardless of whether classification succeeded.
  await runDetectors(transaction.organisationId.toString(), transaction);
  return 'claimed';
}
