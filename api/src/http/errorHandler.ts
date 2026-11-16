import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './errors.js';

function zodDetails(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, requestId: request.id },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request did not match the expected shape',
          details: zodDetails(error),
          requestId: request.id,
        },
      });
      return;
    }

    // Fastify's own request-shape errors (bad JSON, unsupported media type, etc.)
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode < 500) {
      reply.code(statusCode).send({
        error: { code: 'BAD_REQUEST', message: error.message, requestId: request.id },
      });
      return;
    }

    request.log.error({ err: error, requestId: request.id }, 'unhandled error');
    reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: request.id },
    });
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}`, requestId: request.id },
    });
  });
}
