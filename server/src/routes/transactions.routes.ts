import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  correctTransactionController,
  getTransactionController,
  importBatchController,
  importTransactionController,
  listTransactionsController,
} from '../controllers/transactions.controller.js';

export const transactionsRoutes = Router();
transactionsRoutes.post('/transactions', asyncHandler(importTransactionController));
transactionsRoutes.post('/transactions/batch', asyncHandler(importBatchController));
transactionsRoutes.get('/transactions', asyncHandler(listTransactionsController));
transactionsRoutes.get('/transactions/:id', asyncHandler(getTransactionController));
transactionsRoutes.post('/transactions/:id/corrections', asyncHandler(correctTransactionController));
