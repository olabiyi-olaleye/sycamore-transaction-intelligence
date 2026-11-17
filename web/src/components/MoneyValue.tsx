import { formatNaira } from '../money/money.js';

interface MoneyValueProps {
  amount: string;
  direction?: 'credit' | 'debit';
  className?: string;
}

// Credits in --success, debits in --ink, per the design system rule. Always
// .financial-value and right-aligned in tables (handled by the caller's td).
export function MoneyValue({ amount, direction, className }: MoneyValueProps) {
  const colorClass = direction === 'credit' ? 'credit' : direction === 'debit' ? 'debit' : '';
  return <span className={`financial-value ${colorClass} ${className ?? ''}`.trim()}>{formatNaira(amount)}</span>;
}
