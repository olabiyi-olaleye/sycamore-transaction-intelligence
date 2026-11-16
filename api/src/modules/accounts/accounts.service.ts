import mongoose from 'mongoose';
import { NotFoundError } from '../../http/errors.js';
import { type AccountDocument } from '../../db/models/account.model.js';
import { findAccountById, listAccounts as listAccountsRepo } from './accounts.repository.js';

export interface AccountView {
  id: string;
  name: string;
  bankName: string;
  accountNumberLast4: string;
  currency: string;
}

function toView(account: AccountDocument): AccountView {
  return {
    id: account._id.toString(),
    name: account.name,
    bankName: account.bankName,
    accountNumberLast4: account.accountNumberLast4,
    currency: account.currency,
  };
}

export async function listAccounts(organisationId: string): Promise<AccountView[]> {
  const accounts = await listAccountsRepo(organisationId);
  return accounts.map(toView);
}

export async function getAccountById(organisationId: string, accountId: string): Promise<AccountView> {
  // An id from another organisation's data, or one that is not even a valid
  // ObjectId, both just mean "not found" from this caller's point of view —
  // never a 500 from a cast error, and never a 403 that would confirm the id
  // exists somewhere else.
  if (!mongoose.isValidObjectId(accountId)) {
    throw new NotFoundError('Account not found');
  }
  const account = await findAccountById(organisationId, accountId);
  if (!account) {
    throw new NotFoundError('Account not found');
  }
  return toView(account);
}
