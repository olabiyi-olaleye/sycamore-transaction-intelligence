import { Router } from 'express';
import { docsController } from '../controllers/docs.controller.js';
import { healthController } from '../controllers/health.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Public, unprefixed: /health and /docs, not /api/v1/*.
export const systemRoutes = Router();
systemRoutes.get('/health', asyncHandler(healthController));
systemRoutes.get('/docs', docsController);
