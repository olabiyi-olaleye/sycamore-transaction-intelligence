import { categoryLabel } from '../api/types.js';
import { formatNaira, parseKoboForComparison } from '../money/money.js';

interface SpendingBarsProps {
  rows: Array<{ category: string; total: string }>;
}

// Horizontal bars built with plain CSS, per the design system — no chart library.
export function SpendingBars({ rows }: SpendingBarsProps) {
  if (rows.length === 0) {
    return <p className="micro-label">No categorised spending in this period yet</p>;
  }

  // Bar width is the only place a total is compared by magnitude, and the
  // comparison itself is bigint (parseKoboForComparison), not float — only
  // the final 0-100 percentage, an exact small integer, becomes a number.
  const magnitudes = rows.map((row) => parseKoboForComparison(row.total));
  const max = magnitudes.reduce((largest, value) => (value > largest ? value : largest), 1n);

  return (
    <div className="spend-bars">
      {rows.map((row, index) => {
        const percent = Number((magnitudes[index]! * 100n) / max);
        return (
          <div className="spend-bar-row" key={row.category}>
            <span className="label">{categoryLabel(row.category)}</span>
            <span className="spend-bar-track">
              <span className="spend-bar-fill" style={{ width: `${Math.max(4, percent)}%` }} />
            </span>
            <span className="financial-value debit">{formatNaira(row.total)}</span>
          </div>
        );
      })}
    </div>
  );
}
