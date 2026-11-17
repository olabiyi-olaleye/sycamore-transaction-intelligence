import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';

// TODO: also report the pending-classification backlog size here once
// there's an easy way to query it without importing the whole classification
// module into the health check.
export function healthRoutes(app: FastifyInstance): void {
  app.get('/health', async (_request, reply) => {
    const dbConnected = mongoose.connection.readyState === 1;
    reply.code(dbConnected ? 200 : 503).send({
      status: dbConnected ? 'ok' : 'degraded',
      db: dbConnected ? 'connected' : 'disconnected',
    });
  });
}
