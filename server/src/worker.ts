import { connectDb } from './config/database.js';
import { runClaimLoop } from './services/classification/claimLoop.js';

async function main(): Promise<void> {
  try {
    await connectDb();
  } catch (error) {
    console.error('Worker failed to start: could not connect to MongoDB', error);
    process.exit(1);
  }

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  // runClaimLoop handles errors in each iteration itself, so reaching the
  // catch below means something unexpected outside an iteration.
  await runClaimLoop(controller.signal);
}

main().catch((error) => {
  console.error('Worker stopped unexpectedly', error);
  process.exit(1);
});
