import { UserModel, type UserDocument } from '../../db/models/user.model.js';

// Can't take organisationId as an argument like the other lookups here do —
// this is how a login request finds out what it is in the first place.
export function findUserByEmail(email: string): Promise<UserDocument | null> {
  return UserModel.findOne({ email: email.toLowerCase() }).lean();
}

export function findUserById(organisationId: string, userId: string): Promise<UserDocument | null> {
  return UserModel.findOne({ organisationId, _id: userId }).lean();
}
