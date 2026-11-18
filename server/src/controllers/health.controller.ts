import type { Request, Response } from 'express';
import { checkDatabase } from '../db/client.js';
import { classificationQueueStats, type ClassificationQueueStats } from '../repositories/transactions.repository.js';
import { logger } from '../utils/logger.js';

// status/db answer "is the API up and can it reach the database". The queue
// numbers answer "is classification keeping up": oldestDueSeconds climbing
// means the provider is down or no worker is running, even while the API
// itself is healthy. Imports keep working either way, so a slow queue
// doesn't change the status code.
export async function healthController(_req: Request, res: Response): Promise<void> {
  const dbConnected = await checkDatabase();

  let classificationQueue: ClassificationQueueStats | null = null;
  if (dbConnected) {
    try {
      classificationQueue = await classificationQueueStats();
    } catch (error) {
      logger.warn('health_queue_stats_failed', { error });
    }
  }

  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    db: dbConnected ? 'connected' : 'disconnected',
    classificationQueue,
  });
}
