import type { Request, Response } from 'express';
import { requireOrganisationId } from '../context/requestContext.js';
import { getAccountById, listAccounts } from '../services/accounts/accounts.service.js';

export async function listAccountsController(_req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const accounts = await listAccounts(organisationId);
  res.json({ accounts });
}

export async function getAccountController(req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const account = await getAccountById(organisationId, req.params.id as string);
  res.json(account);
}
