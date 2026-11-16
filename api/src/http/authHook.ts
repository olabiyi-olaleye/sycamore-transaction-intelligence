import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/env.js';
import { UnauthorisedError } from './errors.js';
import { getRequestContext, runWithRequestContext } from './requestContext.js';

const tokenPayloadSchema = z.object({
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

// organisationId is set here and nowhere else: it comes from the verified
// token's claim, never from a body, query string, or path parameter. Scoped
// to the protected route group in app.ts, so /auth/login, /health and /docs
// never go through it.
export function authHook(request: FastifyRequest, _reply: FastifyReply, done: (err?: Error) => void): void {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    done(new UnauthorisedError('Missing bearer token'));
    return;
  }

  let decoded: unknown;
  try {
    decoded = jwt.verify(header.slice('Bearer '.length), config.JWT_SECRET);
  } catch {
    done(new UnauthorisedError('Invalid or expired token'));
    return;
  }

  const payload = tokenPayloadSchema.safeParse(decoded);
  if (!payload.success) {
    done(new UnauthorisedError('Token payload is malformed'));
    return;
  }

  const { requestId } = getRequestContext();
  runWithRequestContext(
    {
      requestId,
      organisationId: payload.data.organisationId,
      userId: payload.data.sub,
      role: payload.data.role,
    },
    () => done(),
  );
}
