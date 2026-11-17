import { config } from './config/env.js';
import { connectDb } from './config/database.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  await connectDb();
  const app = buildApp();
  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`API listening on port ${config.PORT}`);
  });
}

main().catch((error) => {
  console.error('API failed to start', error);
  process.exit(1);
});
