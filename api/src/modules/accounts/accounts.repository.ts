import { AccountModel, type AccountDocument } from '../../db/models/account.model.js';

export function listAccounts(organisationId: string): Promise<AccountDocument[]> {
  return AccountModel.find({ organisationId }).sort({ name: 1 }).lean();
}

export function findAccountById(organisationId: string, accountId: string): Promise<AccountDocument | null> {
  return AccountModel.findOne({ organisationId, _id: accountId }).lean();
}
