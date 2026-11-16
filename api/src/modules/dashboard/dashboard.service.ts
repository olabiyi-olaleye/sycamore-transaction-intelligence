import { formatKoboAsAmount } from '../../money/money.js';
import { summarize } from './dashboard.repository.js';
import type { DashboardSummaryQuery } from './dashboard.schema.js';

export interface DashboardSummaryView {
  inflows: string;
  outflows: string;
  net: string;
  spendingByCategory: Array<{ category: string; total: string }>;
  pendingClassificationCount: number;
  // Open review flag count is added in stage 6, once review_flags exists.
  openFlagCount: number;
}

export async function getDashboardSummary(organisationId: string, query: DashboardSummaryQuery): Promise<DashboardSummaryView> {
  const totals = await summarize(organisationId, { from: query.from, to: query.to });
  const netKobo = totals.inflowsKobo - totals.outflowsKobo;

  return {
    inflows: formatKoboAsAmount(totals.inflowsKobo),
    outflows: formatKoboAsAmount(totals.outflowsKobo),
    net: netKobo < 0n ? `-${formatKoboAsAmount(-netKobo)}` : formatKoboAsAmount(netKobo),
    spendingByCategory: totals.spendingByCategory.map((row) => ({
      category: row.category,
      total: formatKoboAsAmount(row.totalKobo),
    })),
    pendingClassificationCount: totals.pendingClassificationCount,
    openFlagCount: 0,
  };
}
