import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';

// Pending backlog is added once the transaction model exists (stage 5); for
// now this proves the API process and the database connection are both up.
export function healthRoutes(app: FastifyInstance): void {
  app.get('/health', async (_request, reply) => {
    const dbConnected = mongoose.connection.readyState === 1;
    reply.code(dbConnected ? 200 : 503).send({
      status: dbConnected ? 'ok' : 'degraded',
      db: dbConnected ? 'connected' : 'disconnected',
    });
  });
}
