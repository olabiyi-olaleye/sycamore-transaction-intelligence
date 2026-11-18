import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext, tryGetRequestContext } from '../context/requestContext.js';
import { logger } from '../utils/logger.js';

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
  const startedAt = process.hrtime.bigint();
  runWithRequestContext({ requestId: req.id }, () => {
    // One line per request when the response is sent. Captured here, inside
    // the context, so it picks up the organisationId that authMiddleware adds.
    res.on('finish', () => {
      logger.info('http_request', {
        requestId: req.id,
        organisationId: tryGetRequestContext()?.organisationId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
      });
    });
    next();
  });
}
