import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { retryFailedController } from '../controllers/classification.controller.js';
import { requireRole } from '../middleware/requireRole.middleware.js';

export const classificationRoutes = Router();
// Requeueing affects the whole organisation's backlog, so it's admin-only.
classificationRoutes.post('/classification/retry-failed', requireRole('admin'), asyncHandler(retryFailedController));
