import type { NextFunction, Request, Response } from 'express';
import { getRequestContext } from '../context/requestContext.js';
import { ForbiddenError } from '../utils/errors.js';

// Mounted per route, after authMiddleware has put the verified role in the
// request context. This is a 403, not a 404: the caller can see the resource
// exists (it's their own organisation's), they just aren't allowed to do this.
export function requireRole(role: 'admin') {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    if (getRequestContext().role !== role) {
      next(new ForbiddenError(`Only an ${role} can do this`));
      return;
    }
    next();
  };
}
