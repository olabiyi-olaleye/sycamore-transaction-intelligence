import { Schema, Types, model } from 'mongoose';

export interface OrganisationSettings {
  largePaymentMultiple: number;
}

export interface OrganisationDocument {
  _id: Types.ObjectId;
  name: string;
  settings: OrganisationSettings;
  createdAt: Date;
  updatedAt: Date;
}

// This is the tenant root, so there's no organisationId to scope it by and
// the tenant-guard plugin doesn't apply here.
const organisationSchema = new Schema<OrganisationDocument>(
  {
    name: { type: String, required: true },
    settings: {
      largePaymentMultiple: { type: Number, required: true, default: 5 },
    },
  },
  { timestamps: true, collection: 'organisations' },
);

export const OrganisationModel = model<OrganisationDocument>('Organisation', organisationSchema);

// Used by the unusually-large-payment detector. There's no dedicated
// organisations layer in this app, and this is the only setting it needs
// from one, so it lives next to the model it reads rather than its own file.
export async function getLargePaymentMultiple(organisationId: string): Promise<number> {
  const org = await OrganisationModel.findById(organisationId).lean();
  return org?.settings.largePaymentMultiple ?? 5;
}
