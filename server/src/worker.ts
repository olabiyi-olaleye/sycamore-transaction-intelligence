import { connectDb } from './config/database.js';
import { runClaimLoop } from './services/classification/claimLoop.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  try {
    await connectDb();
  } catch (error) {
    logger.error('worker_start_failed', { reason: 'could not connect to MongoDB', error });
    process.exit(1);
  }

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  // runClaimLoop handles errors in each iteration itself, so reaching the
  // catch below means something unexpected outside an iteration.
  logger.info('worker_started');
  await runClaimLoop(controller.signal);
  logger.info('worker_stopped');
}

main().catch((error) => {
  logger.error('worker_crashed', { error });
  process.exit(1);
});
