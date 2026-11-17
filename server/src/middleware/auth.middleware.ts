import type { NextFunction, Request, Response } from 'express';
import { UnauthorisedError } from '../utils/errors.js';
import { getRequestContext, runWithRequestContext } from '../context/requestContext.js';
import { tokenPayloadSchema, verifyAccessToken } from '../services/auth/jwt.js';

// organisationId comes from the verified token's claim here, and nowhere
// else: never a body, query string, or path parameter. Mounted only on the
// protected router in app.ts, so /auth/login, /health and /docs skip it.
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorisedError('Missing bearer token'));
    return;
  }

  let decoded: unknown;
  try {
    decoded = verifyAccessToken(header.slice('Bearer '.length));
  } catch {
    next(new UnauthorisedError('Invalid or expired token'));
    return;
  }

  const payload = tokenPayloadSchema.safeParse(decoded);
  if (!payload.success) {
    next(new UnauthorisedError('Token payload is malformed'));
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
    () => next(),
  );
}
