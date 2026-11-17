import { config } from '../config/env.js';
import { processOneClaimedTransaction } from '../modules/classification/classification.service.js';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Claims one transaction per iteration and only backs off when the queue is
// empty, so a backlog drains as fast as the provider allows instead of
// waiting out a fixed poll interval between every row.
export async function runClaimLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const outcome = await processOneClaimedTransaction();
    if (outcome === 'empty') {
      await sleep(config.WORKER_POLL_INTERVAL_MS, signal);
    }
  }
}
