import { defineConfig } from 'vitest/config';

const testEnv = {
  NODE_ENV: 'test',
  PORT: '4100',
  // A throwaway database, recreated on every run by tests/globalSetup.ts.
  // The admin URL needs a superuser; it matches docker-compose.yml's
  // postgres service.
  TEST_ADMIN_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
  DATABASE_URL: 'postgresql://sycamore_app:app_dev_password@localhost:5432/sycamore_test',
  SYSTEM_DATABASE_URL: 'postgresql://sycamore_system:system_dev_password@localhost:5432/sycamore_test',
  JWT_SECRET: 'test-only-secret-not-for-real-use',
  LOG_LEVEL: 'silent',
  CLASSIFIER_PROVIDER: 'mock',
  MOCK_LLM_MODE: 'ok',
  MOCK_LLM_FAILURE_RATE: '0',
  WORKER_POLL_INTERVAL_MS: '50',
  WORKER_LOCK_MS: '2000',
  WORKER_BATCH_SIZE: '10',
  SEED_PASSWORD: 'Passw0rd!2024',
};

// globalSetup runs in the main process before test.env is applied, and it
// needs the database URLs too.
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    env: testEnv,
  },
});
