import argon2 from 'argon2';
import { UnauthorisedError } from '../../http/errors.js';
import { signAccessToken } from '../../http/authHook.js';
import { findUserByEmail } from './auth.repository.js';

export interface LoginResult {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organisationId: string;
  };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await findUserByEmail(email);
  // Same error for "no such user" and "wrong password" so a caller cannot
  // use the response to enumerate registered emails.
  if (!user) {
    throw new UnauthorisedError('Invalid email or password');
  }
  const passwordMatches = await argon2.verify(user.passwordHash, password);
  if (!passwordMatches) {
    throw new UnauthorisedError('Invalid email or password');
  }

  const organisationId = user.organisationId.toString();
  const token = signAccessToken({
    sub: user._id.toString(),
    organisationId,
    role: user.role,
    email: user.email,
  });

  return {
    token,
    user: { id: user._id.toString(), email: user.email, name: user.name, role: user.role, organisationId },
  };
}
