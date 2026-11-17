import { Schema, Types, model } from 'mongoose';
import { tenantScopePlugin } from './tenantPlugin.js';

export interface AccountDocument {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  name: string;
  bankName: string;
  accountNumberLast4: string;
  currency: 'NGN';
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<AccountDocument>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organisation' },
    name: { type: String, required: true },
    bankName: { type: String, required: true },
    accountNumberLast4: { type: String, required: true },
    currency: { type: String, enum: ['NGN'], required: true, default: 'NGN' },
  },
  { timestamps: true, collection: 'accounts' },
);

accountSchema.index({ organisationId: 1 });
accountSchema.plugin(tenantScopePlugin);

export const AccountModel = model<AccountDocument>('Account', accountSchema);

export function listAccounts(organisationId: string): Promise<AccountDocument[]> {
  return AccountModel.find({ organisationId }).sort({ name: 1 }).lean();
}

export function findAccountById(organisationId: string, accountId: string): Promise<AccountDocument | null> {
  return AccountModel.findOne({ organisationId, _id: accountId }).lean();
}
