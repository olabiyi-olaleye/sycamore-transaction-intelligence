import { z } from 'zod';
import { CATEGORIES } from '../transactions/categories.js';

// Validates whatever a provider returns before the app trusts it — a
// malformed body or an unknown category is a failure, not something we cast
// our way past.
export const classifyResultSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});
