import type { Request, Response } from 'express';
import { getRequestContext, requireOrganisationId } from '../context/requestContext.js';
import { listFlagsQuerySchema } from '../validation/review.validation.js';
import { listFlagsView, resolveFlagView } from '../services/review/review.service.js';

export async function listFlagsController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const query = listFlagsQuerySchema.parse(req.query);
  res.json(await listFlagsView(organisationId, query));
}

export async function resolveFlagController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const { userId } = getRequestContext();
  res.json(await resolveFlagView(organisationId, req.params.id as string, userId as string));
}
