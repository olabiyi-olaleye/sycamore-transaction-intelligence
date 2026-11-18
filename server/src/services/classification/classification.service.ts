import { config } from '../../config/env.js';
import { categoryLabel, type Category } from '../../constants/categories.js';
import { createFlag, resolveOpenFlagsForTransaction } from '../../models/reviewFlag.model.js';
import { runDetectors } from '../review/detectors.js';
import {
  applyCorrection,
  claimNextTransaction,
  markClassified,
  markFailed,
  scheduleRetry,
  type TransactionDocument,
} from '../../models/transaction.model.js';
import { insertEvent } from '../../models/classificationEvent.model.js';
import { classifyResultSchema } from '../../validation/classification.validation.js';
import { getClassificationProvider } from './providers.js';
import { RateLimitedProviderError, type ClassificationProvider, type ClassifyInput, type ClassifyResult } from './provider.js';
import { classifyWithRules } from './rules.js';
import { logger } from '../../utils/logger.js';

// A transaction is only given up on after this many bad answers (malformed or
// unknown category). Outages, timeouts and rate limits never count: they
// retry with capped backoff for as long as the provider is away.
const MAX_INVALID_RESPONSES = 5;
const PROVIDER_TIMEOUT_MS = 5000;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// After this many consecutive LLM failures, stop calling the provider for a
// cool-off. Transactions claimed meanwhile are pushed back to when the
// breaker closes, and that skipped attempt isn't counted. Rules keep running
// the whole time. In-memory and per-process, so it only covers a single
// worker; several workers would need to share this state (in Redis, say).
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
  if (circuitOpenUntil !== null) {
    logger.info('circuit_breaker_closed', { afterFailures: consecutiveLlmFailures });
  }
  consecutiveLlmFailures = 0;
  circuitOpenUntil = null;
}

function recordLlmFailure(error: unknown): void {
  consecutiveLlmFailures += 1;
  logger.warn('classification_provider_failed', { consecutiveFailures: consecutiveLlmFailures, error });
  if (consecutiveLlmFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLOFF_MS;
    logger.warn('circuit_breaker_open', {
      consecutiveFailures: consecutiveLlmFailures,
      reopensAt: new Date(circuitOpenUntil).toISOString(),
    });
  }
}

function backoffWithJitter(attempts: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  const jitter = Math.random() * exponential * 0.25;
  return Math.round(exponential + jitter);
}

/** The provider answered, but with something we can't use. */
class InvalidProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProviderResponseError';
  }
}

async function callProviderWithTimeout(provider: ClassificationProvider, input: ClassifyInput): Promise<ClassifyResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const raw = await provider.classify(input, controller.signal);
    const parsed = classifyResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidProviderResponseError(`Provider returned a malformed result: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
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
  // A transaction that failed before and was requeued has an open
  // CLASSIFICATION_FAILED flag; it no longer applies.
  await resolveOpenFlagsForTransaction(organisationId, transactionId, ['CLASSIFICATION_FAILED'], null);

  if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
    await createFlag(organisationId, {
      transactionId,
      type: 'LOW_CONFIDENCE',
      reason: `Categorised as ${categoryLabel(result.category)} with ${Math.round(result.confidence * 100)}% confidence.`,
    });
  }
}

async function handleInvalidResponse(
  organisationId: string,
  transaction: TransactionDocument,
  errorMessage: string,
): Promise<void> {
  const transactionId = transaction._id.toString();
  const invalidSoFar = transaction.classification.invalidResponses + 1;
  logger.warn('classification_invalid_response', { organisationId, transactionId, invalidResponses: invalidSoFar, reason: errorMessage });
  if (invalidSoFar >= MAX_INVALID_RESPONSES) {
    await markFailed(organisationId, transactionId, errorMessage);
    logger.error('classification_gave_up', { organisationId, transactionId, invalidResponses: invalidSoFar });
    await createFlag(organisationId, {
      transactionId,
      type: 'CLASSIFICATION_FAILED',
      reason: `Automatic categorisation returned an unusable answer ${MAX_INVALID_RESPONSES} times.`,
    });
    return;
  }
  const delayMs = backoffWithJitter(transaction.classification.attempts);
  await scheduleRetry(organisationId, transactionId, errorMessage, new Date(Date.now() + delayMs), { invalidResponse: true });
}

async function handleUnavailable(
  organisationId: string,
  transaction: TransactionDocument,
  errorMessage: string,
  retryAfterMs: number | undefined,
): Promise<void> {
  const delayMs = retryAfterMs ?? backoffWithJitter(transaction.classification.attempts);
  await scheduleRetry(organisationId, transaction._id.toString(), errorMessage, new Date(Date.now() + delayMs));
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

  if (isCircuitOpen() && circuitOpenUntil !== null) {
    // Small jitter so the whole backlog doesn't come due in the same instant.
    const retryAt = new Date(circuitOpenUntil + Math.round(Math.random() * 5000));
    await scheduleRetry(organisationId, transactionId, 'LLM circuit breaker open; skipped call', retryAt, { refundAttempt: true });
    return;
  }

  const provider = getClassificationProvider();
  try {
    const result = await callProviderWithTimeout(provider, input);
    recordLlmSuccess();
    await finishClassification(organisationId, transactionId, result, 'ai', provider.name);
  } catch (error) {
    const message = (error as Error).message;
    if (error instanceof InvalidProviderResponseError) {
      // The provider is up, it just answered badly, so the breaker isn't touched.
      await handleInvalidResponse(organisationId, transaction, message);
      return;
    }
    recordLlmFailure(error);
    const retryAfterMs = error instanceof RateLimitedProviderError ? error.retryAfterMs : undefined;
    await handleUnavailable(organisationId, transaction, message, retryAfterMs);
  }
}

/**
 * A manual correction: writes the event and updates the transaction in one
 * multi-document transaction (models/transaction.model.ts's applyCorrection),
 * then resolves any LOW_CONFIDENCE or CLASSIFICATION_FAILED flag on it, since a
 * human has just done what those flags were asking for.
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
  try {
    await classifyTransaction(transaction);
    // Duplicate/large-payment detection is about the raw transaction, not its
    // category, so it runs regardless of whether classification succeeded.
    await runDetectors(transaction.organisationId.toString(), transaction);
  } catch (error) {
    // Name the transaction in the log; the loop in claimLoop.ts carries on.
    throw new Error(`Processing transaction ${transaction._id.toString()} failed: ${(error as Error).message}`, { cause: error });
  }
  return 'claimed';
}
