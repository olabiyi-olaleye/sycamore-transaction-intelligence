import type { Request, Response } from 'express';
import { openApiSpec } from '../config/openapi.config.js';

export function docsController(_req: Request, res: Response): void {
  res.json(openApiSpec);
}
