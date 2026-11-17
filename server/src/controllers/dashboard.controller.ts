import type { Request, Response } from 'express';
import { requireOrganisationId } from '../context/requestContext.js';
import { dashboardSummaryQuerySchema } from '../validation/dashboard.validation.js';
import { getDashboardSummary } from '../services/dashboard/dashboard.service.js';

export async function dashboardSummaryController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const query = dashboardSummaryQuerySchema.parse(req.query);
  res.json(await getDashboardSummary(organisationId, query));
}
