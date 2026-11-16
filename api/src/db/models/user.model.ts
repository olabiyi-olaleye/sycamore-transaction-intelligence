import { Schema, Types, model } from 'mongoose';

export type UserRole = 'admin' | 'member';

export interface UserDocument {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organisation' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['admin', 'member'], required: true },
  },
  { timestamps: true, collection: 'users' },
);

// Deliberately not wrapped with tenantScopePlugin. Every other tenant
// collection is only ever read after organisationId is already known from a
// verified token, but logging in is the one place that has to look a user up
// by email alone, before their organisationId is known — that is the exact
// query the plugin exists to forbid. CLAUDE.md allows exactly one documented
// bypass (the worker's claim query), so rather than add a second one here,
// this collection goes without the plugin; every other read of it still
// takes organisationId as an explicit filter at the call site (see
// auth.repository.ts findUserById) as defence in depth.
export const UserModel = model<UserDocument>('User', userSchema);
