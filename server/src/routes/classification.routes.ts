import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { retryFailedController } from '../controllers/classification.controller.js';

export const classificationRoutes = Router();
classificationRoutes.post('/classification/retry-failed', asyncHandler(retryFailedController));
