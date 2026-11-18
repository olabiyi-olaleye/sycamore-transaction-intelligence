// Loads server/.env for local dev. Doesn't override vars already set, so
// it's a no-op in Docker (docker-compose.yml passes env vars directly).
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET should be a long random string, not a guessable word'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Which ClassificationProvider the worker calls; see services/classification/providers.ts.
  CLASSIFIER_PROVIDER: z.enum(['mock']).default('mock'),
  MOCK_LLM_MODE: z.enum(['ok', 'slow', 'down', 'rate_limited', 'invalid']).default('ok'),
  MOCK_LLM_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_LOCK_MS: z.coerce.number().int().positive().default(30000),
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
