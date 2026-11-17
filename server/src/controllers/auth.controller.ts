import type { Request, Response } from 'express';
import { NotFoundError } from '../utils/errors.js';
import { getRequestContext, requireOrganisationId } from '../context/requestContext.js';
import { findUserById } from '../models/user.model.js';
import { loginSchema } from '../validation/auth.validation.js';
import { login } from '../services/auth/auth.service.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const body = loginSchema.parse(req.body);
  const result = await login(body.email, body.password);
  res.status(200).json(result);
}

export async function meController(_req: Request, res: Response): Promise<void> {
  const organisationId = requireOrganisationId();
  const { userId } = getRequestContext();
  const user = await findUserById(organisationId, userId as string);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  res.json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    organisationId,
  });
}
