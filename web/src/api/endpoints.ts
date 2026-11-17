import { apiFetch } from './client.js';
import type {
  Account,
  AuthUser,
  DashboardSummary,
  LoginResponse,
  ReviewFlag,
  ReviewFlagListResponse,
  TransactionDetail,
  TransactionListResponse,
} from './types.js';

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/me');
}

export function fetchAccounts(): Promise<{ accounts: Account[] }> {
  return apiFetch<{ accounts: Account[] }>('/accounts');
}

export function fetchTransactions(query: URLSearchParams): Promise<TransactionListResponse> {
  const qs = query.toString();
  return apiFetch<TransactionListResponse>(`/transactions${qs ? `?${qs}` : ''}`);
}

export function fetchTransaction(id: string): Promise<TransactionDetail> {
  return apiFetch<TransactionDetail>(`/transactions/${id}`);
}

export function correctTransaction(id: string, category: string, note: string | undefined): Promise<TransactionDetail> {
  return apiFetch<TransactionDetail>(`/transactions/${id}/corrections`, {
    method: 'POST',
    body: JSON.stringify(note ? { category, note } : { category }),
  });
}

export function fetchDashboardSummary(query: URLSearchParams): Promise<DashboardSummary> {
  const qs = query.toString();
  return apiFetch<DashboardSummary>(`/dashboard/summary${qs ? `?${qs}` : ''}`);
}

export function fetchReviewFlags(query: URLSearchParams): Promise<ReviewFlagListResponse> {
  const qs = query.toString();
  return apiFetch<ReviewFlagListResponse>(`/review/flags${qs ? `?${qs}` : ''}`);
}

export function resolveFlag(id: string): Promise<ReviewFlag> {
  return apiFetch<ReviewFlag>(`/review/flags/${id}/resolve`, { method: 'POST' });
}
