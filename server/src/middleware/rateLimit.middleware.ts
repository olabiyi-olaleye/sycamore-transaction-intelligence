import type { NextFunction, Request, Response } from 'express';
import { RateLimitedError } from '../utils/errors.js';

// In-memory, per-process — fine for one instance, but a horizontally scaled
// deployment would need this in Redis instead, since each instance would
// otherwise have its own counter.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, { count: number; windowStart: number }>();

// Keyed on ip+email rather than ip alone, so a shared IP (an office NAT) can't
// get every account behind it locked out by attempts against one of them.
export function loginRateLimitMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const key = `${req.ip}:${email}`;

  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    next(new RateLimitedError('Too many login attempts. Try again later.'));
    return;
  }
  next();
}
