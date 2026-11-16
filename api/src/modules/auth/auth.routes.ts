import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../../http/errors.js';
import { checkLoginRateLimit } from '../../http/rateLimit.js';
import { getRequestContext, requireOrganisationId } from '../../http/requestContext.js';
import { findUserById } from './auth.repository.js';
import { loginSchema } from './auth.schema.js';
import { login } from './auth.service.js';

// Public: no auth hook runs ahead of this route (see app.ts registration).
export function authRoutes(app: FastifyInstance): void {
  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    checkLoginRateLimit(`${request.ip}:${body.email}`);
    const result = await login(body.email, body.password);
    reply.code(200).send(result);
  });
}

// Protected: registered inside app.ts's auth-hooked group.
export function meRoutes(app: FastifyInstance): void {
  app.get('/me', async (_request, reply) => {
    const organisationId = requireOrganisationId();
    const { userId } = getRequestContext();
    const user = await findUserById(organisationId, userId as string);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    reply.send({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      organisationId,
    });
  });
}
