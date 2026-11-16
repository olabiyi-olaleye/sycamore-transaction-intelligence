// Typed application errors. The global error handler (errorHandler.ts) is the
// only place that turns these into HTTP responses.
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class UnauthorisedError extends AppError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORISED';
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

export class RateLimitedError extends AppError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMITED';
}
