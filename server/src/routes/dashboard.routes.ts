import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { dashboardSummaryController } from '../controllers/dashboard.controller.js';

export const dashboardRoutes = Router();
dashboardRoutes.get('/dashboard/summary', asyncHandler(dashboardSummaryController));
