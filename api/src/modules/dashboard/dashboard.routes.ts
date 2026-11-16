import type { FastifyInstance } from 'fastify';
import { requireOrganisationId } from '../../http/requestContext.js';
import { dashboardSummaryQuerySchema } from './dashboard.schema.js';
import { getDashboardSummary } from './dashboard.service.js';

export function dashboardRoutes(app: FastifyInstance): void {
  app.get('/dashboard/summary', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const query = dashboardSummaryQuerySchema.parse(request.query);
    const summary = await getDashboardSummary(organisationId, query);
    reply.send(summary);
  });
}
