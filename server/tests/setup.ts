import { afterAll, beforeAll } from 'vitest';
import { connectDb, disconnectDb } from '../src/config/database.js';
import { AccountModel } from '../src/models/account.model.js';
import { TransactionModel } from '../src/models/transaction.model.js';
import { UserModel } from '../src/models/user.model.js';

beforeAll(async () => {
  await connectDb();
  // Build indexes (including the transaction text index) up front so a
  // $text query in an early test never races index creation.
  await Promise.all([UserModel.init(), AccountModel.init(), TransactionModel.init()]);
});

afterAll(async () => {
  await disconnectDb();
});
