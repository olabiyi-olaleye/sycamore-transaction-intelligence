import { Router } from 'express';
import { docsController } from '../controllers/docs.controller.js';
import { healthController } from '../controllers/health.controller.js';

// Public, unprefixed: /health and /docs, not /api/v1/*.
export const systemRoutes = Router();
systemRoutes.get('/health', healthController);
systemRoutes.get('/docs', docsController);
