import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getAccountController, listAccountsController } from '../controllers/accounts.controller.js';

export const accountsRoutes = Router();
accountsRoutes.get('/accounts', asyncHandler(listAccountsController));
accountsRoutes.get('/accounts/:id', asyncHandler(getAccountController));
