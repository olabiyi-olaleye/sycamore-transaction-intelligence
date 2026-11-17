import type { FastifyInstance } from 'fastify';
import { getRequestContext, requireOrganisationId } from '../../http/requestContext.js';
import { listFlagsQuerySchema } from './review.schema.js';
import { listFlagsView, resolveFlagView } from './review.service.js';

export function reviewRoutes(app: FastifyInstance): void {
  app.get('/review/flags', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const query = listFlagsQuerySchema.parse(request.query);
    reply.send(await listFlagsView(organisationId, query));
  });

  app.post('/review/flags/:id/resolve', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const { userId } = getRequestContext();
    const { id } = request.params as { id: string };
    reply.send(await resolveFlagView(organisationId, id, userId as string));
  });
}
