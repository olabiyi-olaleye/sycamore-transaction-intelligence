import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { loginRateLimitMiddleware } from '../middleware/rateLimit.middleware.js';
import { loginController, meController } from '../controllers/auth.controller.js';

// Public: mounted without authMiddleware in app.ts.
export const authRoutes = Router();
authRoutes.post('/auth/login', loginRateLimitMiddleware, asyncHandler(loginController));

// Protected: mounted on the auth-hooked router in app.ts.
export const meRoutes = Router();
meRoutes.get('/me', asyncHandler(meController));
