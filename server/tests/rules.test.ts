import { describe, expect, it } from 'vitest';
import { classifyWithRules } from '../src/services/classification/rules.js';

const base = { merchant: null, amountKobo: 100000n };

describe('classification rules', () => {
  it('treats a payroll funding transfer between own accounts as a transfer, not payroll', () => {
    const debit = classifyWithRules({ ...base, narration: 'Transfer to own account - payroll funding', direction: 'debit' });
    const credit = classifyWithRules({ ...base, narration: 'Transfer from Operating Account - payroll funding', direction: 'credit' });
    expect(debit?.category).toBe('TRANSFERS');
    expect(credit?.category).toBe('TRANSFERS');
  });

  it('still classifies a salary payment as payroll', () => {
    expect(classifyWithRules({ ...base, narration: 'Monthly SALARY payment - March payroll', direction: 'debit' })?.category).toBe('PAYROLL');
  });

  it('classifies a customer payment received as revenue, but only for a credit', () => {
    expect(classifyWithRules({ ...base, narration: 'Payment received from Shoprite Lekki', direction: 'credit' })?.category).toBe('REVENUE');
    expect(classifyWithRules({ ...base, narration: 'Payment received from Shoprite Lekki', direction: 'debit' })?.category).not.toBe('REVENUE');
  });
});
