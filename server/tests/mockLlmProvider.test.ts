import { describe, expect, it } from 'vitest';
import { CREDIT_CATEGORIES, DEBIT_CATEGORIES } from '../src/constants/categories.js';
import { pseudoClassify } from '../src/services/classification/mockLlmProvider.js';

const narrations = Array.from({ length: 200 }, (_, i) => `Payment ref ${i} to vendor ${i * 7}`);

describe('mock LLM categories follow the direction', () => {
  it('only gives a credit a credit category', () => {
    for (const narration of narrations) {
      const { category } = pseudoClassify({ narration, merchant: null, direction: 'credit', amountKobo: 100000n });
      expect(CREDIT_CATEGORIES).toContain(category);
    }
  });

  it('never gives a debit the Revenue category', () => {
    for (const narration of narrations) {
      const { category } = pseudoClassify({ narration, merchant: null, direction: 'debit', amountKobo: 100000n });
      expect(DEBIT_CATEGORIES).toContain(category);
      expect(category).not.toBe('REVENUE');
    }
  });
});

describe('mock LLM hints', () => {
  it('gives a recognisable supplier payment a sensible category with fair confidence', () => {
    const result = pseudoClassify({ narration: 'Payment to Dangote Flour Mills for supplies', merchant: 'Dangote Flour Mills', direction: 'debit', amountKobo: 100000n });
    expect(result.category).toBe('OTHER');
    expect(result.confidence).toBeGreaterThanOrEqual(0.62);
  });

  it('is unsure about a vague narration', () => {
    const result = pseudoClassify({ narration: 'Misc disbursement', merchant: null, direction: 'debit', amountKobo: 100000n });
    expect(result.confidence).toBeLessThan(0.7);
  });
});
