import { categoryLabel } from '../api/types.js';
import { formatNaira, parseKoboForComparison } from '../money/money.js';

interface SpendingBarsProps {
  rows: Array<{ category: string; total: string }>;
}

// Plain CSS bars, no chart library.
export function SpendingBars({ rows }: SpendingBarsProps) {
  if (rows.length === 0) {
    return <p className="micro-label">No categorised spending in this period yet</p>;
  }

  // Compares totals in bigint (parseKoboForComparison); only the resulting
  // 0-100 percentage becomes a JS number, for the CSS width.
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
