import { config } from '../../config/env.js';
import { processClaimedBatch } from './classification.service.js';
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
  processBatch?: () => Promise<number>;
  onError?: (error: unknown) => void;
  pollIntervalMs?: number;
}

function logError(error: unknown): void {
  logger.error('worker_iteration_failed', { error });
}

// Claims WORKER_BATCH_SIZE rows at a time and only sleeps when nothing was
// due (or after an error), so a backlog drains at provider speed instead of
// one batch per poll interval. An error in one iteration (a database blip,
// say) is logged and the loop carries on; anything it had claimed stays
// locked until the lock expires, then gets reclaimed.
export async function runClaimLoop(signal: AbortSignal, options: ClaimLoopOptions = {}): Promise<void> {
  const processBatch = options.processBatch ?? (() => processClaimedBatch(config.WORKER_BATCH_SIZE));
  const onError = options.onError ?? logError;
  const pollIntervalMs = options.pollIntervalMs ?? config.WORKER_POLL_INTERVAL_MS;

  while (!signal.aborted) {
    try {
      const claimed = await processBatch();
      if (claimed === 0) {
        await sleep(pollIntervalMs, signal);
      }
    } catch (error) {
      onError(error);
      await sleep(pollIntervalMs, signal);
    }
  }
}
