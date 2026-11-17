import type { Direction } from '../../db/models/transaction.model.js';
import type { Category } from '../transactions/categories.js';
import type { ClassifyInput, ClassifyResult } from './provider.js';

interface Rule {
  pattern: RegExp;
  category: Category;
  confidence: number;
  reason: string;
  direction?: Direction;
}

// Confidence 0.9+ on every rule, comfortably above the 0.6 LOW_CONFIDENCE
// threshold and high enough that a hit never needs the AI step at all.
const RULES: Rule[] = [
  { pattern: /salary|payroll/i, category: 'PAYROLL', confidence: 0.95, reason: 'Narration mentions salary or payroll', direction: 'debit' },
  { pattern: /\bpaye\b/i, category: 'TAX', confidence: 0.95, reason: 'Narration mentions PAYE' },
  { pattern: /\bfirs\b|vat remittance/i, category: 'TAX', confidence: 0.95, reason: 'Narration mentions FIRS or a VAT remittance' },
  { pattern: /stamp duty/i, category: 'TAX', confidence: 0.97, reason: 'Narration mentions stamp duty' },
  { pattern: /ikedc|eko\s*disco|electricity/i, category: 'UTILITIES', confidence: 0.92, reason: 'Narration mentions an electricity provider' },
  { pattern: /\baws\b|amazon web services|google cloud|microsoft azure|github|vercel/i, category: 'SOFTWARE', confidence: 0.93, reason: 'Narration mentions a cloud or software vendor' },
  { pattern: /nip charge|transfer fee|sms alert charge|card maintenance/i, category: 'BANKING_FEES', confidence: 0.97, reason: 'Narration mentions a bank fee' },
  { pattern: /\brent\b/i, category: 'RENT', confidence: 0.9, reason: 'Narration mentions rent' },
  { pattern: /own account transfer|transfer to self/i, category: 'TRANSFERS', confidence: 0.9, reason: 'Narration indicates an own-account transfer' },
];

/** Returns null when no rule decides, which means "ask the AI provider". */
export function classifyWithRules(input: ClassifyInput): ClassifyResult | null {
  const text = `${input.narration} ${input.merchant ?? ''}`;
  for (const rule of RULES) {
    if (rule.direction && rule.direction !== input.direction) continue;
    if (rule.pattern.test(text)) {
      return { category: rule.category, confidence: rule.confidence, reason: rule.reason };
    }
  }
  return null;
}
