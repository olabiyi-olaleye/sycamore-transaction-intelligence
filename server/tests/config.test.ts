import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const tsxBin = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

// Spawns a real process rather than importing env.ts directly, because
// loadConfig() calls process.exit(1) on invalid config and would otherwise
// kill the test runner itself. Calls the local tsx binary directly rather
// than through `npx`, which under load would otherwise add its own slow,
// variable resolution step on top of the process we're actually testing.
function runWithEnv(env: Record<string, string | undefined>) {
  return spawnSync(tsxBin, ['src/config/env.ts'], {
    cwd: serverRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: true,
    timeout: 15000,
  });
}

describe('config', () => {
  it('exits non-zero and explains why when DATABASE_URL is missing', () => {
    const result = runWithEnv({ DATABASE_URL: '', JWT_SECRET: 'a-sufficiently-long-secret-for-testing' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
  });

  it('exits non-zero when JWT_SECRET is too short', () => {
    const result = runWithEnv({
      DATABASE_URL: 'postgresql://sycamore_app:x@localhost:5432/sycamore_test',
      JWT_SECRET: 'short',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JWT_SECRET');
  });

  it('starts cleanly with valid config', () => {
    const result = runWithEnv({
      DATABASE_URL: 'postgresql://sycamore_app:x@localhost:5432/sycamore_test',
      JWT_SECRET: 'test-only-secret-not-for-real-use-but-long-enough',
    });

    expect(result.status).toBe(0);
  });
});
