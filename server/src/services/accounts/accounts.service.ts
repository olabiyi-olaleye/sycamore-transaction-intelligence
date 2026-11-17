import mongoose from 'mongoose';
import { NotFoundError } from '../../utils/errors.js';
import { findAccountById, listAccounts as listAccountsRepo, type AccountDocument } from '../../models/account.model.js';

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
  // A malformed id shouldn't 500 from a Mongoose cast error; treat it the
  // same as a valid id that just doesn't belong to this organisation.
  if (!mongoose.isValidObjectId(accountId)) {
    throw new NotFoundError('Account not found');
  }
  const account = await findAccountById(organisationId, accountId);
  if (!account) {
    throw new NotFoundError('Account not found');
  }
  return toView(account);
}
