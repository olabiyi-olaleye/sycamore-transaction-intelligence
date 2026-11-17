import type { Request, Response } from 'express';
import mongoose from 'mongoose';

// TODO: also report the pending-classification backlog size here once
// there's an easy way to query it without importing the whole classification
// module into the health check.
export function healthController(_req: Request, res: Response): void {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    db: dbConnected ? 'connected' : 'disconnected',
  });
}
