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

// Which categories make sense for money coming in versus going out. The
// mock provider picks only from the list matching the direction, so a credit
// is never labelled Rent and a debit is never labelled Revenue.
export const CREDIT_CATEGORIES: readonly Category[] = ['REVENUE', 'TRANSFERS', 'OTHER'];
export const DEBIT_CATEGORIES: readonly Category[] = CATEGORIES.filter((category) => category !== 'REVENUE');

export function categoriesForDirection(direction: 'credit' | 'debit'): readonly Category[] {
  return direction === 'credit' ? CREDIT_CATEGORIES : DEBIT_CATEGORIES;
}

const LABELS: Record<Category, string> = {
  REVENUE: 'Revenue',
  PAYROLL: 'Payroll',
  SOFTWARE: 'Software',
  MARKETING: 'Marketing',
  TRAVEL: 'Travel',
  UTILITIES: 'Utilities',
  RENT: 'Rent',
  TAX: 'Tax',
  TRANSFERS: 'Transfers',
  BANKING_FEES: 'Banking Fees',
  OTHER: 'Other',
};

/** REVENUE -> "Revenue", BANKING_FEES -> "Banking Fees". For review flag reasons and the UI. */
export function categoryLabel(category: Category): string {
  return LABELS[category];
}
