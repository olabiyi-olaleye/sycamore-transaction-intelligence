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

// Not wrapped with tenantScopePlugin, unlike every other tenant collection:
// logging in means finding a user by email alone, before organisationId is
// even known, which is the exact kind of query the plugin forbids. The
// worker's claim query is already the one documented bypass, so this skips
// the plugin entirely instead of adding a second one. Every other read of
// this collection (see auth.repository.ts's findUserById) still filters by
// organisationId explicitly at the call site.
export const UserModel = model<UserDocument>('User', userSchema);
