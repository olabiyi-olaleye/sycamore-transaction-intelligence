// Loads api/.env for local dev. Doesn't override vars already set, so this
// is a no-op in Docker (docker-compose.yml passes env vars directly).
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MOCK_LLM_MODE: z.enum(['ok', 'slow', 'down', 'rate_limited', 'invalid']).default('ok'),
  MOCK_LLM_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_LOCK_MS: z.coerce.number().int().positive().default(30000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  SEED_PASSWORD: z.string().min(8).default('Passw0rd!2024'),
});

export type Config = Readonly<z.infer<typeof schema>>;

function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    console.error('Invalid configuration, refusing to start:');
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }
  return Object.freeze(result.data);
}

export const config = loadConfig();
