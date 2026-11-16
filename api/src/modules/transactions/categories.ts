export const CATEGORIES = [
  'REVENUE',
  'PAYROLL',
  'SOFTWARE',
  'MARKETING',
  'TRAVEL',
  'UTILITIES',
  'RENT',
  'TAX',
  'TRANSFERS',
  'BANKING_FEES',
  'OTHER',
] as const;

export type Category = (typeof CATEGORIES)[number];
