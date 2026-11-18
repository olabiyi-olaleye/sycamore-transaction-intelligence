import { config } from '../../config/env.js';
import { categoriesForDirection, type Category } from '../../constants/categories.js';
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

// Rough keyword hints, so the mock behaves a bit like a real model: a
// recognisable narration gets a sensible category with fair-to-high
// confidence, and a vague one ("Misc disbursement") gets a guess with low
// confidence, which is what feeds the LOW_CONFIDENCE review flag.
const HINTS: Array<{ pattern: RegExp; category: Category; direction?: 'credit' | 'debit' }> = [
  { pattern: /supplies|supplier|raw material|inventory|equipment|purchase/i, category: 'OTHER', direction: 'debit' },
  { pattern: /internet|data plan|spectranet|\bmtn\b|airtel|\bglo\b/i, category: 'UTILITIES', direction: 'debit' },
  { pattern: /advert|campaign|marketing|promo|billboard/i, category: 'MARKETING', direction: 'debit' },
  { pattern: /flight|hotel|airline|\buber\b|\bbolt\b|travel/i, category: 'TRAVEL', direction: 'debit' },
  { pattern: /subscription|licen[cs]e|\bsaas\b/i, category: 'SOFTWARE', direction: 'debit' },
  { pattern: /\bfees?\b|bank charge|commission/i, category: 'BANKING_FEES', direction: 'debit' },
];

export function pseudoClassify(input: ClassifyInput): ClassifyResult {
  const text = `${input.narration} ${input.merchant ?? ''}`.toLowerCase();
  const categoryHash = djb2(text);
  // Hash the merchant alone for confidence, not the full narration: a lot of
  // real narrations share a template ("Payment to X for supplies") with only
  // the merchant varying, and hashing the whole string left confidence
  // correlated with the template rather than spread out. Falls back to the
  // full text when there's no merchant to hash.
  const confidenceHash = djb2(input.merchant ? input.merchant.toLowerCase() : text);
  const hint = HINTS.find((h) => (!h.direction || h.direction === input.direction) && h.pattern.test(text));
  if (hint) {
    const confidence = 0.62 + (confidenceHash % 33) / 100; // 0.62-0.94
    return { category: hint.category, confidence, reason: `Mock LLM matched ${hint.category} from the narration` };
  }

  const allowed = categoriesForDirection(input.direction);
  const category = allowed[categoryHash % allowed.length] ?? 'OTHER';
  const confidence = 0.45 + (confidenceHash % 25) / 100; // 0.45-0.69, mostly under the 0.6 LOW_CONFIDENCE threshold
  return { category, confidence, reason: `Mock LLM guessed ${category}; the narration gives little to go on` };
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
