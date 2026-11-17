import type { Request, Response } from 'express';
import { getRequestContext, requireOrganisationId } from '../context/requestContext.js';
import {
  batchEnvelopeSchema,
  correctionSchema,
  importTransactionSchema,
  listTransactionsQuerySchema,
} from '../validation/transactions.validation.js';
import {
  correctTransaction,
  getTransactionDetail,
  importBatch,
  importTransaction,
  listTransactionsView,
} from '../services/transactions/transactions.service.js';

export async function importTransactionController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const input = importTransactionSchema.parse(req.body);
  const outcome = await importTransaction(organisationId, input);
  res.status(outcome.status === 'created' ? 201 : 200).json(outcome.transaction);
}

export async function importBatchController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const body = batchEnvelopeSchema.parse(req.body);
  const result = await importBatch(organisationId, body.transactions);
  res.status(200).json(result);
}

export async function listTransactionsController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const query = listTransactionsQuerySchema.parse(req.query);
  const result = await listTransactionsView(organisationId, query);
  res.json(result);
}

export async function getTransactionController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const detail = await getTransactionDetail(organisationId, req.params.id as string);
  res.json(detail);
}

export async function correctTransactionController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const { userId } = getRequestContext();
  const body = correctionSchema.parse(req.body);
  const detail = await correctTransaction(organisationId, req.params.id as string, userId as string, body.category, body.note);
  res.json(detail);
}
