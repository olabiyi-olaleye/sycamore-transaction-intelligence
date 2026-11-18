import { afterAll } from 'vitest';
import { disconnectDb } from '../src/db/client.js';

afterAll(async () => {
  await disconnectDb();
});
