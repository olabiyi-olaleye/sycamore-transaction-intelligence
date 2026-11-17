import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../context/requestContext.js';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

// First middleware in the chain: stamps a request id and opens the request
// context. authMiddleware adds organisationId to it further down the chain.
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.id = randomUUID();
  res.setHeader('x-request-id', req.id);
  runWithRequestContext({ requestId: req.id }, () => next());
}
