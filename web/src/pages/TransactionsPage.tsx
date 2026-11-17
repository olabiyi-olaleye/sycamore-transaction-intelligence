import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAccounts, fetchTransactions } from '../api/endpoints.js';
import { CATEGORIES, categoryLabel } from '../api/types.js';
import { MoneyValue } from '../components/MoneyValue.js';
import { StateMessage } from '../components/StateMessage.js';
import { StatusBadge } from '../components/StatusBadge.js';

interface Filters {
  accountId: string;
  direction: string;
  category: string;
  reviewStatus: string;
  from: string;
  to: string;
  q: string;
}

const EMPTY_FILTERS: Filters = { accountId: '', direction: '', category: '', reviewStatus: '', from: '', to: '', q: '' };

function buildQuery(filters: Filters, cursor: string | undefined): URLSearchParams {
  const params = new URLSearchParams({ limit: '25' });
  if (filters.accountId) params.set('accountId', filters.accountId);
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.category) params.set('category', filters.category);
  if (filters.reviewStatus) params.set('reviewStatus', filters.reviewStatus);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.q) params.set('q', filters.q);
  if (cursor) params.set('cursor', cursor);
  return params;
}

export function TransactionsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [cursors, setCursors] = useState<string[]>([]); // history, for "back"

  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });

  const currentCursor = cursors[cursors.length - 1];
  const query = useMemo(() => buildQuery(filters, currentCursor), [filters, currentCursor]);

  const transactionsQuery = useQuery({
    queryKey: ['transactions', query.toString()],
    queryFn: () => fetchTransactions(query),
  });

  function applyFilters(next: Filters): void {
    setFilters(next);
    setCursors([]);
  }

  function goNext(): void {
    if (transactionsQuery.data?.nextCursor) {
      setCursors((prev) => [...prev, transactionsQuery.data!.nextCursor!]);
    }
  }

  function goBack(): void {
    setCursors((prev) => prev.slice(0, -1));
  }

  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div>
      <section className="panel">
        <h2 className="panel__title">Transactions</h2>

        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters(filters);
          }}
        >
          <div className="field">
            <label className="micro-label" htmlFor="q">
              Search
            </label>
            <input
              id="q"
              placeholder="Narration, merchant or reference"
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="micro-label" htmlFor="accountId">
              Account
            </label>
            <select
              id="accountId"
              value={filters.accountId}
              onChange={(event) => setFilters((prev) => ({ ...prev, accountId: event.target.value }))}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.bankName})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="micro-label" htmlFor="direction">
              Direction
            </label>
            <select
              id="direction"
              value={filters.direction}
              onChange={(event) => setFilters((prev) => ({ ...prev, direction: event.target.value }))}
            >
              <option value="">Credit or debit</option>
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </select>
          </div>
          <div className="field">
            <label className="micro-label" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              value={filters.category}
              onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="micro-label" htmlFor="reviewStatus">
              Review status
            </label>
            <select
              id="reviewStatus"
              value={filters.reviewStatus}
              onChange={(event) => setFilters((prev) => ({ ...prev, reviewStatus: event.target.value }))}
            >
              <option value="">Any review status</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="field">
            <label className="micro-label" htmlFor="from">
              From
            </label>
            <input
              id="from"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="micro-label" htmlFor="to">
              To
            </label>
            <input
              id="to"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
          </div>
          <button type="submit" className="primary">
            Apply filters
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setCursors([]);
            }}
          >
            Clear
          </button>
        </form>

        {transactionsQuery.isLoading && <StateMessage>Loading transactions…</StateMessage>}
        {transactionsQuery.isError && (
          <StateMessage tone="error">Could not load transactions: {transactionsQuery.error.message}</StateMessage>
        )}
        {transactionsQuery.data && transactionsQuery.data.transactions.length === 0 && (
          <StateMessage>No transactions match these filters.</StateMessage>
        )}
        {transactionsQuery.data && transactionsQuery.data.transactions.length > 0 && (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Narration</th>
                  <th>Category</th>
                  <th>Review</th>
                  <th className="align-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactionsQuery.data.transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="row-link"
                    onClick={() => navigate(`/transactions/${transaction.id}`)}
                  >
                    <td>{transaction.date.slice(0, 10)}</td>
                    <td>
                      {transaction.narration}
                      {transaction.merchant ? ` — ${transaction.merchant}` : ''}
                    </td>
                    <td>
                      {transaction.category ? (
                        <span className="pill">{categoryLabel(transaction.category.value)}</span>
                      ) : (
                        <StatusBadge status={transaction.classification.status} />
                      )}
                    </td>
                    <td>
                      <StatusBadge status={transaction.reviewStatus} />
                    </td>
                    <td className="align-right">
                      <MoneyValue amount={transaction.amount} direction={transaction.direction} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination">
              <button type="button" className="secondary" onClick={goBack} disabled={cursors.length === 0}>
                Previous page
              </button>
              <button type="button" className="secondary" onClick={goNext} disabled={!transactionsQuery.data.nextCursor}>
                Next page
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
