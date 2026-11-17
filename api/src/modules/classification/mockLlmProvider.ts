import { config } from '../../config/env.js';
import { CATEGORIES } from '../transactions/categories.js';
import { RateLimitedProviderError, type ClassificationProvider, type ClassifyInput, type ClassifyResult } from './provider.js';

export type MockLlmMode = 'ok' | 'slow' | 'down' | 'rate_limited' | 'invalid';

// Mutable rather than read straight from config, so tests (and, in a real
// deployment, an admin endpoint) can flip the mode without a restart.
let mode: MockLlmMode = config.MOCK_LLM_MODE;
let failureRate: number = config.MOCK_LLM_FAILURE_RATE;

export function setMockLlmMode(next: MockLlmMode): void {
  mode = next;
}

export function setMockLlmFailureRate(next: number): void {
  failureRate = next;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Request aborted'));
    });
  });
}

// Quick deterministic hash so the mock doesn't need a lookup table but still
// gives a repeatable category/confidence per input.
function djb2(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return hash >>> 0;
}

function pseudoClassify(input: ClassifyInput): ClassifyResult {
  const text = `${input.narration} ${input.merchant ?? ''}`.toLowerCase();
  const categoryHash = djb2(text);
  // Hash the merchant alone for confidence, not the full narration: a lot of
  // real narrations share a template ("Payment to X for supplies") with only
  // the merchant varying, and hashing the whole string left confidence
  // correlated with the template rather than spread out. Falls back to the
  // full text when there's no merchant to hash.
  const confidenceHash = djb2(input.merchant ? input.merchant.toLowerCase() : text);
  const category = CATEGORIES[categoryHash % CATEGORIES.length] ?? 'OTHER';
  const confidence = 0.5 + (confidenceHash % 45) / 100; // spans 0.50-0.94, straddling the 0.6 LOW_CONFIDENCE threshold
  return { category, confidence, reason: `Mock LLM inferred ${category} from narration pattern` };
}

export const mockLlmProvider: ClassificationProvider = {
  name: 'mock-llm',
  async classify(input: ClassifyInput, signal: AbortSignal): Promise<ClassifyResult> {
    if (Math.random() < failureRate) {
      throw new Error('Simulated transient provider failure');
    }

    switch (mode) {
      case 'down':
        throw new Error('LLM provider is unavailable');
      case 'rate_limited':
        throw new RateLimitedProviderError('LLM provider rate limit exceeded', 2000);
      case 'invalid':
        // Deliberately malformed: an unknown category and an out-of-range
        // confidence, so classifyResultSchema is what catches this, not luck.
        return { category: 'NOT_A_REAL_CATEGORY', confidence: 1.5, reason: '' } as unknown as ClassifyResult;
      case 'slow':
        await delay(10_000, signal); // well past the 5s caller timeout
        return pseudoClassify(input);
      case 'ok':
      default:
        return pseudoClassify(input);
    }
  },
};
