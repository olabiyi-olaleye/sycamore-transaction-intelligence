import { config } from './config/env.js';
import { connectDb } from './config/database.js';
import { buildApp } from './app.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  await connectDb();
  const app = buildApp();
  app.listen(config.PORT, '0.0.0.0', () => {
    logger.info('api_listening', { port: config.PORT });
  });
}

main().catch((error) => {
  logger.error('api_start_failed', { error });
  process.exit(1);
});
