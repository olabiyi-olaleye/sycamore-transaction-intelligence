import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '4100',
      MONGO_URI: 'mongodb://localhost:27017/sycamore_test?replicaSet=rs0&directConnection=true',
      JWT_SECRET: 'test-only-secret-not-for-real-use',
      LOG_LEVEL: 'silent',
      MOCK_LLM_MODE: 'ok',
      MOCK_LLM_FAILURE_RATE: '0',
      WORKER_POLL_INTERVAL_MS: '50',
      WORKER_LOCK_MS: '2000',
      WORKER_BATCH_SIZE: '10',
      SEED_PASSWORD: 'Passw0rd!2024',
    },
    fileParallelism: false,
  },
});
