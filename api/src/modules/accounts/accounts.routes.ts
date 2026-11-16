import type { FastifyInstance } from 'fastify';
import { requireOrganisationId } from '../../http/requestContext.js';
import { getAccountById, listAccounts } from './accounts.service.js';

export function accountsRoutes(app: FastifyInstance): void {
  app.get('/accounts', async (_request, reply) => {
    const organisationId = requireOrganisationId();
    const accounts = await listAccounts(organisationId);
    reply.send({ accounts });
  });

  app.get('/accounts/:id', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const { id } = request.params as { id: string };
    const account = await getAccountById(organisationId, id);
    reply.send(account);
  });
}
