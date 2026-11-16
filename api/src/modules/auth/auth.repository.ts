import { UserModel, type UserDocument } from '../../db/models/user.model.js';

// The one lookup in the app that cannot take organisationId as a first
// argument: login is how organisationId gets discovered in the first place.
export function findUserByEmail(email: string): Promise<UserDocument | null> {
  return UserModel.findOne({ email: email.toLowerCase() }).lean();
}

export function findUserById(organisationId: string, userId: string): Promise<UserDocument | null> {
  return UserModel.findOne({ organisationId, _id: userId }).lean();
}
