import { config } from '../../config/env.js';
import { processOneClaimedTransaction } from './classification.service.js';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Only sleeps when the queue is actually empty, so a backlog drains at
// provider speed instead of one row per poll interval.
export async function runClaimLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const outcome = await processOneClaimedTransaction();
    if (outcome === 'empty') {
      await sleep(config.WORKER_POLL_INTERVAL_MS, signal);
    }
  }
}
