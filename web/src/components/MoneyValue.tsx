import { formatNaira } from '../money/money.js';

interface MoneyValueProps {
  amount: string;
  direction?: 'credit' | 'debit';
  className?: string;
}

// Right-alignment is the caller's td; this just handles the colour and the
// tabular-numbers styling.
export function MoneyValue({ amount, direction, className }: MoneyValueProps) {
  const colorClass = direction === 'credit' ? 'credit' : direction === 'debit' ? 'debit' : '';
  return <span className={`financial-value ${colorClass} ${className ?? ''}`.trim()}>{formatNaira(amount)}</span>;
}
