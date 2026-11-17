import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../../config/env.js';

export const tokenPayloadSchema = z.object({
  sub: z.string(),
  organisationId: z.string(),
  role: z.enum(['admin', 'member']),
  email: z.string(),
});

export interface TokenPayload {
  sub: string;
  organisationId: string;
  role: 'admin' | 'member';
  email: string;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '1h' });
}

export function verifyAccessToken(token: string): unknown {
  return jwt.verify(token, config.JWT_SECRET);
}
