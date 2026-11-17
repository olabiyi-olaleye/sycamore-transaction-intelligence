import type { FastifyInstance } from 'fastify';
import { openApiSpec } from './spec.js';

// Public: the spec itself has no sensitive content, and a client needs it
// before it has a token.
export function docsRoutes(app: FastifyInstance): void {
  app.get('/docs', async (_request, reply) => {
    reply.send(openApiSpec);
  });
}
