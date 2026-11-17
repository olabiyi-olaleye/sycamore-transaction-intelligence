import { z } from 'zod';

export const listFlagsQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListFlagsQuery = z.infer<typeof listFlagsQuerySchema>;
