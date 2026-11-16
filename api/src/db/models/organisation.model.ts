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

// The tenant root. Not itself organisationId-scoped — there is nothing above
// it to scope against — so the tenant-guard plugin does not apply here.
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
