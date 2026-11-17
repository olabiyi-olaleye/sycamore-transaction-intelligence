import type { Request, Response } from 'express';
import { requireOrganisationId } from '../context/requestContext.js';
import { requeueFailed } from '../models/transaction.model.js';

// Sends this organisation's failed transactions back to the worker. Their
// CLASSIFICATION_FAILED flags stay open until each one classifies, and the
// worker resolves them then.
export async function retryFailedController(_req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const requeued = await requeueFailed(organisationId);
  res.json({ requeued });
}
