import cors from 'cors';
import express, { Router, type Express } from 'express';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { authRoutes, meRoutes } from './routes/auth.routes.js';
import { accountsRoutes } from './routes/accounts.routes.js';
import { transactionsRoutes } from './routes/transactions.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { reviewRoutes } from './routes/review.routes.js';
import { classificationRoutes } from './routes/classification.routes.js';
import { systemRoutes } from './routes/system.routes.js';

export function buildApp(): Express {
  const app = express();

  app.use(cors());
  // Before express.json(): req.id has to exist even if JSON parsing itself
  // fails, since errorMiddleware reads it for every error response.
  app.use(requestIdMiddleware);
  // Express defaults this to 100kb, which a 1000-row transaction batch
  // comfortably exceeds; raised so the batch size limit below is what
  // actually rejects an oversized request, not the body parser.
  app.use(express.json({ limit: '2mb' }));

  app.use(systemRoutes);

  // Public: no bearer token required.
  app.use('/api/v1', authRoutes);

  // Protected: authMiddleware is mounted on this router only, so it never
  // runs for /auth/login, /health or /docs above.
  const protectedRouter = Router();
  protectedRouter.use(authMiddleware);
  protectedRouter.use(meRoutes);
  protectedRouter.use(accountsRoutes);
  protectedRouter.use(transactionsRoutes);
  protectedRouter.use(dashboardRoutes);
  protectedRouter.use(reviewRoutes);
  protectedRouter.use(classificationRoutes);
  app.use('/api/v1', protectedRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
