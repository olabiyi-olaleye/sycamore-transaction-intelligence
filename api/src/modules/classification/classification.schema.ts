import { z } from 'zod';
import { CATEGORIES } from '../transactions/categories.js';

// Validates whatever a provider returns before the app trusts it. An AI
// provider is not a type system: a malformed body or an unknown category
// both count as a failure, never a cast.
export const classifyResultSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});
