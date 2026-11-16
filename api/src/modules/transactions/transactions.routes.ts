import type { FastifyInstance } from 'fastify';
import { requireOrganisationId } from '../../http/requestContext.js';
import { batchEnvelopeSchema, importTransactionSchema } from './transactions.schema.js';
import { importBatch, importTransaction } from './transactions.service.js';

export function transactionsRoutes(app: FastifyInstance): void {
  app.post('/transactions', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const input = importTransactionSchema.parse(request.body);
    const outcome = await importTransaction(organisationId, input);
    reply.code(outcome.status === 'created' ? 201 : 200).send(outcome.transaction);
  });

  app.post('/transactions/batch', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const body = batchEnvelopeSchema.parse(request.body);
    const result = await importBatch(organisationId, body.transactions);
    reply.code(200).send(result);
  });
}
