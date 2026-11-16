import { RateLimitedError } from './errors.js';

// In-memory and per-process: fine for a single-node prototype, not for a
// horizontally scaled deployment (each instance would have its own counter).
// A real deployment would move this to a shared store (Redis) keyed the same
// way. Noted in the README as a known limitation.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, { count: number; windowStart: number }>();

export function checkLoginRateLimit(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    throw new RateLimitedError('Too many login attempts. Try again later.');
  }
}

export function resetLoginRateLimit(key: string): void {
  attempts.delete(key);
}
