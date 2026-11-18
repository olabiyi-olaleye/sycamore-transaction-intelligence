import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function zodDetails(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

// Registered last in app.ts, after every route. Express routes any error
// passed to next(err) (or thrown inside an async handler wrapped by
// asyncHandler) here, and nowhere else turns an error into a response.
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request did not match the expected shape',
        details: zodDetails(err),
        requestId: req.id,
      },
    });
    return;
  }

  // Express's own body-parser errors (bad JSON, etc.) carry a statusCode.
  const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
  if (typeof statusCode === 'number' && statusCode < 500) {
    res.status(statusCode).json({ error: { code: 'BAD_REQUEST', message: (err as Error).message, requestId: req.id } });
    return;
  }

  logger.error('unhandled_error', { requestId: req.id, method: req.method, path: req.originalUrl, error: err });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: req.id } });
}

export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}`, requestId: req.id },
  });
}
