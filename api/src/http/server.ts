import { config } from '../config/env.js';
import { connectDb } from '../db/connection.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  await connectDb();
  const app = buildApp();
  await app.listen({ host: '0.0.0.0', port: config.PORT });
}

main().catch((error) => {
  console.error('API failed to start', error);
  process.exit(1);
});
