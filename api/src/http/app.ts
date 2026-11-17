import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { registerErrorHandler } from './errorHandler.js';
import { runWithRequestContext } from './requestContext.js';
import { healthRoutes } from './health.routes.js';
import { authHook } from './authHook.js';
import { authRoutes, meRoutes } from '../modules/auth/auth.routes.js';
import { accountsRoutes } from '../modules/accounts/accounts.routes.js';
import { transactionsRoutes } from '../modules/transactions/transactions.routes.js';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes.js';
import { reviewRoutes } from '../modules/review/review.routes.js';
import { docsRoutes } from '../openapi/docs.routes.js';

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
  app.register(docsRoutes);

  // Public: no bearer token required.
  app.register(authRoutes, { prefix: '/api/v1' });

  // Protected: the auth hook is added inside this encapsulated child
  // instance, so it applies only to routes registered within it, not to the
  // public routes above or /health.
  app.register(
    async (protectedApp) => {
      protectedApp.addHook('onRequest', authHook);
      protectedApp.register(meRoutes);
      protectedApp.register(accountsRoutes);
      protectedApp.register(transactionsRoutes);
      protectedApp.register(dashboardRoutes);
      protectedApp.register(reviewRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
