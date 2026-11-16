import { describe, expect, it } from 'vitest';
import { formatKoboAsAmount, formatNaira, parseAmountToKobo } from '../src/money/money.js';

describe('parseAmountToKobo', () => {
  it('parses a whole naira amount', () => {
    expect(parseAmountToKobo('100')).toBe(10000n);
  });

  it('parses two decimal places', () => {
    expect(parseAmountToKobo('12999.75')).toBe(1299975n);
  });

  it('pads a single decimal place', () => {
    expect(parseAmountToKobo('5.5')).toBe(550n);
  });

  it('rejects three decimal places', () => {
    expect(() => parseAmountToKobo('5.123')).toThrow();
  });

  it('rejects zero', () => {
    expect(() => parseAmountToKobo('0')).toThrow('greater than zero');
  });

  it('rejects a negative amount', () => {
    expect(() => parseAmountToKobo('-5.00')).toThrow();
  });

  it('rejects a non-numeric string', () => {
    expect(() => parseAmountToKobo('twelve')).toThrow();
  });

  it('round-trips a value above Number.MAX_SAFE_INTEGER without precision loss', () => {
    // Number.MAX_SAFE_INTEGER is 9_007_199_254_740_991. A naira amount whose
    // kobo value exceeds that would silently lose precision if it ever
    // passed through a float, which is exactly what this module exists to
    // avoid.
    const hugeAmount = '90071992547409.99';
    const kobo = parseAmountToKobo(hugeAmount);
    expect(kobo).toBe(9007199254740999n);
    expect(kobo > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(formatKoboAsAmount(kobo)).toBe(hugeAmount);
  });
});

describe('formatKoboAsAmount', () => {
  it('formats whole kobo back to a decimal string', () => {
    expect(formatKoboAsAmount(10000n)).toBe('100.00');
  });

  it('pads a fraction below 10 kobo', () => {
    expect(formatKoboAsAmount(1005n)).toBe('10.05');
  });

  it('is the exact inverse of parseAmountToKobo for the worked example', () => {
    expect(formatKoboAsAmount(parseAmountToKobo('12999.75'))).toBe('12999.75');
  });

  it('rejects a negative value', () => {
    expect(() => formatKoboAsAmount(-1n)).toThrow();
  });
});

describe('formatNaira', () => {
  it('adds the currency symbol and thousands separators', () => {
    expect(formatNaira(parseAmountToKobo('12999.75'))).toBe('₦12,999.75');
  });

  it('handles an amount under one thousand with no separator', () => {
    expect(formatNaira(parseAmountToKobo('500.00'))).toBe('₦500.00');
  });

  it('handles millions with multiple separators', () => {
    expect(formatNaira(parseAmountToKobo('4500000.00'))).toBe('₦4,500,000.00');
  });
});
