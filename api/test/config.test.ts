import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const tsxBin = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

// Spawns a real process rather than importing env.ts directly, because
// loadConfig() calls process.exit(1) on invalid config and would otherwise
// kill the test runner itself. Calls the local tsx binary directly rather
// than through `npx`, which under load would otherwise add its own slow,
// variable resolution step on top of the process we're actually testing.
function runWithEnv(env: Record<string, string | undefined>) {
  return spawnSync(tsxBin, ['src/config/env.ts'], {
    cwd: apiRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: true,
    timeout: 15000,
  });
}

describe('config', () => {
  it('exits non-zero and explains why when MONGO_URI is missing', () => {
    const result = runWithEnv({ MONGO_URI: '', JWT_SECRET: 'a-sufficiently-long-secret' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MONGO_URI');
  });

  it('exits non-zero when JWT_SECRET is too short', () => {
    const result = runWithEnv({
      MONGO_URI: 'mongodb://localhost:27017/sycamore_test?replicaSet=rs0&directConnection=true',
      JWT_SECRET: 'short',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JWT_SECRET');
  });

  it('starts cleanly with valid config', () => {
    const result = runWithEnv({
      MONGO_URI: 'mongodb://localhost:27017/sycamore_test?replicaSet=rs0&directConnection=true',
      JWT_SECRET: 'test-only-secret-not-for-real-use',
    });

    expect(result.status).toBe(0);
  });
});
