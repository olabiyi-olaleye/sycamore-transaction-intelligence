import { connectDb } from '../db/connection.js';
import { runClaimLoop } from './claimLoop.js';

async function main(): Promise<void> {
  await connectDb();
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  await runClaimLoop(controller.signal);
}

main().catch((error) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
