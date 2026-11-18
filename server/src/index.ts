import { config } from './config/env.js';
import { checkDatabase } from './db/client.js';
import { buildApp } from './app.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  if (!(await checkDatabase())) {
    throw new Error('Could not connect to Postgres');
  }
  const app = buildApp();
  app.listen(config.PORT, '0.0.0.0', () => {
    logger.info('api_listening', { port: config.PORT });
  });
}

main().catch((error) => {
  logger.error('api_start_failed', { error });
  process.exit(1);
});
