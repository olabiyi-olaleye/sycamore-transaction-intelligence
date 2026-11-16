import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { registerErrorHandler } from './errorHandler.js';
import { runWithRequestContext } from './requestContext.js';
import { healthRoutes } from './health.routes.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization'],
    },
  });

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    // Every log line and error response inside this request can read the
    // request ID (and, once the auth hook runs, the caller's organisationId)
    // without threading it through every function call.
    runWithRequestContext({ requestId: request.id }, () => done());
  });

  app.register(cors, { origin: true });
  registerErrorHandler(app);
  app.register(healthRoutes);

  return app;
}
