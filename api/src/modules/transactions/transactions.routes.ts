import type { FastifyInstance } from 'fastify';
import { getRequestContext, requireOrganisationId } from '../../http/requestContext.js';
import {
  batchEnvelopeSchema,
  correctionSchema,
  importTransactionSchema,
  listTransactionsQuerySchema,
} from './transactions.schema.js';
import {
  correctTransaction,
  getTransactionDetail,
  importBatch,
  importTransaction,
  listTransactionsView,
} from './transactions.service.js';

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

  app.get('/transactions', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const query = listTransactionsQuerySchema.parse(request.query);
    const result = await listTransactionsView(organisationId, query);
    reply.send(result);
  });

  app.get('/transactions/:id', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const { id } = request.params as { id: string };
    const detail = await getTransactionDetail(organisationId, id);
    reply.send(detail);
  });

  app.post('/transactions/:id/corrections', async (request, reply) => {
    const organisationId = requireOrganisationId();
    const { userId } = getRequestContext();
    const { id } = request.params as { id: string };
    const body = correctionSchema.parse(request.body);
    const detail = await correctTransaction(organisationId, id, userId as string, body.category, body.note);
    reply.send(detail);
  });
}
