import { afterAll, beforeAll } from 'vitest';
import { connectDb, disconnectDb } from '../src/db/connection.js';

beforeAll(async () => {
  await connectDb();
});

afterAll(async () => {
  await disconnectDb();
});
