import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { correctTransaction, fetchTransaction, resolveFlag } from '../api/endpoints.js';
import { CATEGORIES, categoryLabel } from '../api/types.js';
import { MoneyValue } from '../components/MoneyValue.js';
import { StateMessage } from '../components/StateMessage.js';
import { StatusBadge } from '../components/StatusBadge.js';

export function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['transaction', id],
    queryFn: () => fetchTransaction(id!),
    enabled: Boolean(id),
  });

  function invalidateEverything(): void {
    queryClient.invalidateQueries({ queryKey: ['transaction', id] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    queryClient.invalidateQueries({ queryKey: ['review-flags'] });
  }

  const correctionMutation = useMutation({
    mutationFn: () => correctTransaction(id!, category, note.trim() ? note.trim() : undefined),
    onSuccess: () => {
      setNote('');
      invalidateEverything();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Correction failed'),
  });

  const resolveMutation = useMutation({
    mutationFn: (flagId: string) => resolveFlag(flagId),
    onSuccess: invalidateEverything,
  });

  if (detailQuery.isLoading) {
    return <StateMessage>Loading transaction…</StateMessage>;
  }
  if (detailQuery.isError) {
    return <StateMessage tone="error">Could not load this transaction: {detailQuery.error.message}</StateMessage>;
  }

  const transaction = detailQuery.data!;

  function handleCorrect(event: FormEvent): void {
    event.preventDefault();
    setFormError(null);
    if (!category) {
      setFormError('Choose a category first.');
      return;
    }
    correctionMutation.mutate();
  }

  return (
    <div>
      <p>
        <Link to="/transactions">&larr; Back to transactions</Link>
      </p>

      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2 className="panel__title">
              {transaction.narration}
              {transaction.merchant ? ` — ${transaction.merchant}` : ''}
            </h2>
            <dl className="kv-list">
              <dt>Amount</dt>
              <dd>
                <MoneyValue amount={transaction.amount} direction={transaction.direction} />
                {' '}
                <StatusBadge status={transaction.direction} />
              </dd>
              <dt>Date</dt>
              <dd>{transaction.date.slice(0, 10)}</dd>
              <dt>External reference</dt>
              <dd className="financial-value">{transaction.externalReference}</dd>
              <dt>Current category</dt>
              <dd>{transaction.category ? categoryLabel(transaction.category.value) : 'Not yet classified'}</dd>
              <dt>Classification</dt>
              <dd>
                <StatusBadge status={transaction.classification.status} />
                {transaction.classification.lastError && (
                  <span className="micro-label"> — {transaction.classification.lastError}</span>
                )}
              </dd>
              <dt>Review status</dt>
              <dd>
                <StatusBadge status={transaction.reviewStatus} />
              </dd>
            </dl>
          </section>

          <section className="panel">
            <h2 className="panel__title">Classification history</h2>
            {transaction.classificationHistory.length === 0 ? (
              <StateMessage>No classification yet — this transaction is still waiting on the worker.</StateMessage>
            ) : (
              <ul className="timeline">
                {transaction.classificationHistory.map((event, index) => (
                  <li key={index}>
                    <div className="timeline__meta">
                      {new Date(event.createdAt).toLocaleString()} &middot; {event.source}
                      {event.source === 'human' && event.actorUserId ? ` (user ${event.actorUserId.slice(-6)})` : ''}
                    </div>
                    <div>
                      {event.previousCategory ? `${categoryLabel(event.previousCategory)} → ` : ''}
                      <strong>{categoryLabel(event.category)}</strong>
                      {event.confidence !== null ? ` (${Math.round(event.confidence * 100)}% confidence)` : ''}
                    </div>
                    <div className="micro-label">{event.reason}</div>
                    {event.note && <div className="micro-label">Note: {event.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <h2 className="panel__title">Review flags</h2>
            {transaction.flags.length === 0 ? (
              <StateMessage>No flags on this transaction.</StateMessage>
            ) : (
              <ul className="flag-list">
                {transaction.flags.map((flag) => (
                  <li key={flag.id}>
                    <div>
                      <span className="pill">{flag.type.replace(/_/g, ' ')}</span> <StatusBadge status={flag.status} />
                    </div>
                    <p>{flag.reason}</p>
                    {flag.status === 'open' && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={resolveMutation.isPending}
                        onClick={() => resolveMutation.mutate(flag.id)}
                      >
                        Mark resolved
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2 className="panel__title">Correct category</h2>
            <form onSubmit={handleCorrect}>
              <div className="field">
                <label className="micro-label" htmlFor="category">
                  New category
                </label>
                <select id="category" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">Choose a category</option>
                  {CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {categoryLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="micro-label" htmlFor="note">
                  Note (optional)
                </label>
                <textarea id="note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <button type="submit" className="primary" disabled={correctionMutation.isPending}>
                {correctionMutation.isPending ? 'Saving…' : 'Save correction'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
