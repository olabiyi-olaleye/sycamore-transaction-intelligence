import { config } from '../../config/env.js';
import { processOneClaimedTransaction } from './classification.service.js';
import { logger } from '../../utils/logger.js';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export interface ClaimLoopOptions {
  processOne?: () => Promise<'claimed' | 'empty'>;
  onError?: (error: unknown) => void;
  pollIntervalMs?: number;
}

function logError(error: unknown): void {
  logger.error('worker_iteration_failed', { error });
}

// Only sleeps when the queue is empty (or after an error), so a backlog
// drains at provider speed instead of one row per poll interval. An error in
// one iteration (a database blip, an unexpected document) is logged and the
// loop carries on. The transaction it was working on is still locked, so it
// gets reclaimed once its lock expires.
export async function runClaimLoop(signal: AbortSignal, options: ClaimLoopOptions = {}): Promise<void> {
  const processOne = options.processOne ?? processOneClaimedTransaction;
  const onError = options.onError ?? logError;
  const pollIntervalMs = options.pollIntervalMs ?? config.WORKER_POLL_INTERVAL_MS;

  while (!signal.aborted) {
    try {
      const outcome = await processOne();
      if (outcome === 'empty') {
        await sleep(pollIntervalMs, signal);
      }
    } catch (error) {
      onError(error);
      await sleep(pollIntervalMs, signal);
    }
  }
}
