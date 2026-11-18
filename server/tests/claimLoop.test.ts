import { describe, expect, it } from 'vitest';
import { runClaimLoop } from '../src/services/classification/claimLoop.js';

describe('worker claim loop', () => {
  it('logs an error from one iteration and keeps going', async () => {
    const controller = new AbortController();
    const errors: unknown[] = [];
    let calls = 0;

    await runClaimLoop(controller.signal, {
      pollIntervalMs: 1,
      onError: (error) => errors.push(error),
      processBatch: async () => {
        calls += 1;
        if (calls === 1) throw new Error('simulated database blip');
        if (calls === 3) controller.abort();
        return 5;
      },
    });

    expect(calls).toBe(3);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('simulated database blip');
  });
});
