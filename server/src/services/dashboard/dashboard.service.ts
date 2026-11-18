import { formatKoboAsAmount } from '../../utils/money.js';
import { countOpenFlags } from '../../repositories/reviewFlags.repository.js';
import { summarizeTransactions } from '../../repositories/transactions.repository.js';
import type { DashboardSummaryQuery } from '../../validation/dashboard.validation.js';

export interface DashboardSummaryView {
  inflows: string;
  outflows: string;
  net: string;
  internalTransfers: string;
  spendingByCategory: Array<{ category: string; total: string }>;
  pendingClassificationCount: number;
  openFlagCount: number;
}

export async function getDashboardSummary(organisationId: string, query: DashboardSummaryQuery): Promise<DashboardSummaryView> {
  const [totals, openFlagCount] = await Promise.all([
    summarizeTransactions(organisationId, { from: query.from, to: query.to }),
    countOpenFlags(organisationId),
  ]);
  const netKobo = totals.inflowsKobo - totals.outflowsKobo;

  return {
    inflows: formatKoboAsAmount(totals.inflowsKobo),
    outflows: formatKoboAsAmount(totals.outflowsKobo),
    net: netKobo < 0n ? `-${formatKoboAsAmount(-netKobo)}` : formatKoboAsAmount(netKobo),
    internalTransfers: formatKoboAsAmount(totals.internalTransfersKobo),
    spendingByCategory: totals.spendingByCategory.map((row) => ({
      category: row.category,
      total: formatKoboAsAmount(row.totalKobo),
    })),
    pendingClassificationCount: totals.pendingClassificationCount,
    openFlagCount,
  };
}
