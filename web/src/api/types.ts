export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organisationId: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface Account {
  id: string;
  name: string;
  bankName: string;
  accountNumberLast4: string;
  currency: string;
}

export interface TransactionCategoryView {
  value: string;
  source: string;
  confidence: number;
}

export interface TransactionClassificationView {
  status: 'pending' | 'processing' | 'classified' | 'failed';
  attempts: number;
  lastError: string | null;
}

export interface Transaction {
  id: string;
  accountId: string;
  externalReference: string;
  amount: string;
  direction: 'credit' | 'debit';
  currency: string;
  narration: string;
  merchant: string | null;
  date: string;
  category: TransactionCategoryView | null;
  classification: TransactionClassificationView;
  reviewStatus: 'none' | 'open' | 'resolved';
}

export interface TransactionListResponse {
  transactions: Transaction[];
  nextCursor: string | null;
}

export interface ClassificationHistoryEntry {
  source: string;
  provider: string;
  category: string;
  previousCategory: string | null;
  confidence: number | null;
  reason: string;
  actorUserId: string | null;
  note: string | null;
  createdAt: string;
}

export interface TransactionFlag {
  id: string;
  type: string;
  reason: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}

export interface TransactionDetail extends Transaction {
  classificationHistory: ClassificationHistoryEntry[];
  flags: TransactionFlag[];
}

export interface DashboardSummary {
  inflows: string;
  outflows: string;
  net: string;
  spendingByCategory: Array<{ category: string; total: string }>;
  pendingClassificationCount: number;
  openFlagCount: number;
}

export interface ReviewFlag {
  id: string;
  transactionId: string;
  type: string;
  reason: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}

export interface ReviewFlagListResponse {
  flags: ReviewFlag[];
  nextCursor: string | null;
}

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

const CATEGORY_LABELS: Record<Category, string> = {
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

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as Category] ?? category;
}
