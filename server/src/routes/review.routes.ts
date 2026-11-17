import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { listFlagsController, resolveFlagController } from '../controllers/review.controller.js';

export const reviewRoutes = Router();
reviewRoutes.get('/review/flags', asyncHandler(listFlagsController));
reviewRoutes.post('/review/flags/:id/resolve', asyncHandler(resolveFlagController));
