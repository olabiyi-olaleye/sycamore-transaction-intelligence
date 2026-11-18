import { isUuid } from '../../db/tenant.js';
import { NotFoundError } from '../../utils/errors.js';
import { findAccountById, listAccounts as listAccountsRepo, type Account } from '../../repositories/accounts.repository.js';

export interface AccountView {
  id: string;
  name: string;
  bankName: string;
  accountNumberLast4: string;
  currency: string;
}

function toView(account: Account): AccountView {
  return {
    id: account.id,
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
  // A malformed id would otherwise reach Postgres as an invalid uuid and
  // fail with a 500; treat it the same as an id from another organisation.
  if (!isUuid(accountId)) {
    throw new NotFoundError('Account not found');
  }
  const account = await findAccountById(organisationId, accountId);
  if (!account) {
    throw new NotFoundError('Account not found');
  }
  return toView(account);
}
