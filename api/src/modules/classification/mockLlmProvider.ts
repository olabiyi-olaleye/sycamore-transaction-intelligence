import { config } from '../../config/env.js';
import { CATEGORIES } from '../transactions/categories.js';
import { RateLimitedProviderError, type ClassificationProvider, type ClassifyInput, type ClassifyResult } from './provider.js';

export type MockLlmMode = 'ok' | 'slow' | 'down' | 'rate_limited' | 'invalid';

// Mutable at runtime (seeded from env) rather than read from the frozen
// config object directly. An operator flips this with a real restart +
// env change after an outage; tests flip it in-process to prove the backlog
// drains once it does, without needing a second process.
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

// Deterministic so the same narration always gets the same mock category —
// useful for predictable tests — without a lookup table to maintain.
function djb2(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return hash >>> 0;
}

function pseudoClassify(input: ClassifyInput): ClassifyResult {
  const hash = djb2(`${input.narration} ${input.merchant ?? ''}`.toLowerCase());
  const category = CATEGORIES[hash % CATEGORIES.length] ?? 'OTHER';
  const confidence = 0.5 + ((hash >> 8) % 45) / 100; // spans 0.50-0.94, straddling the 0.6 LOW_CONFIDENCE threshold
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
