import type { FastifyInstance } from 'fastify';
import { openApiSpec } from './spec.js';

export function docsRoutes(app: FastifyInstance): void {
  app.get('/docs', async (_request, reply) => {
    reply.send(openApiSpec);
  });
}
