import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchDashboardSummary, fetchReviewFlags } from '../api/endpoints.js';
import { SpendingBars } from '../components/SpendingBars.js';
import { StateMessage } from '../components/StateMessage.js';
import { formatNaira } from '../money/money.js';

export function DashboardPage() {
  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => fetchDashboardSummary(new URLSearchParams()),
  });
  const flagsQuery = useQuery({
    queryKey: ['review-flags', 'open-preview'],
    queryFn: () => fetchReviewFlags(new URLSearchParams({ status: 'open', limit: '8' })),
  });

  if (summaryQuery.isLoading) {
    return <StateMessage>Loading dashboard…</StateMessage>;
  }
  if (summaryQuery.isError) {
    return <StateMessage tone="error">Could not load the dashboard: {summaryQuery.error.message}</StateMessage>;
  }

  const summary = summaryQuery.data!;

  return (
    <div>
      <section className="panel">
        <h2 className="panel__title">Cash flow</h2>
        <div className="stat-grid">
          <div className="stat-card">
            <span className="micro-label">Inflows</span>
            <div className="stat-card__value financial-value credit">{formatNaira(summary.inflows)}</div>
          </div>
          <div className="stat-card">
            <span className="micro-label">Outflows</span>
            <div className="stat-card__value financial-value debit">{formatNaira(summary.outflows)}</div>
          </div>
          <div className="stat-card">
            <span className="micro-label">Net cash flow</span>
            <div className="stat-card__value financial-value">{formatNaira(summary.net)}</div>
          </div>
          <div className="stat-card">
            <span className="micro-label">Between own accounts</span>
            <div className="stat-card__value financial-value">{formatNaira(summary.internalTransfers)}</div>
            <span className="micro-label">Not counted in inflows, outflows or spending</span>
          </div>
          <div className="stat-card">
            <span className="micro-label">Pending classification</span>
            <div className="stat-card__value pending">{summary.pendingClassificationCount}</div>
          </div>
          <div className="stat-card">
            <span className="micro-label">Open review flags</span>
            <div className="stat-card__value flagged">{summary.openFlagCount}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Spending by category</h2>
        <SpendingBars rows={summary.spendingByCategory} />
      </section>

      <section className="panel">
        <h2 className="panel__title">Flagged for review</h2>
        {flagsQuery.isLoading && <StateMessage>Loading flags…</StateMessage>}
        {flagsQuery.isError && (
          <StateMessage tone="error">Could not load review flags: {flagsQuery.error.message}</StateMessage>
        )}
        {flagsQuery.data && flagsQuery.data.flags.length === 0 && <StateMessage>Nothing needs review right now.</StateMessage>}
        {flagsQuery.data && flagsQuery.data.flags.length > 0 && (
          <ul className="flag-list">
            {flagsQuery.data.flags.map((flag) => (
              <li key={flag.id}>
                <Link to={`/transactions/${flag.transactionId}`}>
                  <span className="pill">{flag.type.replace(/_/g, ' ')}</span> {flag.reason}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
