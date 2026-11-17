import mongoose from 'mongoose';
import { TransactionModel } from '../../db/models/transaction.model.js';
import type { Category } from '../transactions/categories.js';

export interface DashboardRange {
  from?: Date;
  to?: Date;
}

export interface CategorySpend {
  category: Category;
  totalKobo: bigint;
}

export interface DashboardTotals {
  inflowsKobo: bigint;
  outflowsKobo: bigint;
  spendingByCategory: CategorySpend[];
  pendingClassificationCount: number;
}

function dateMatch(range: DashboardRange): Record<string, Date> | undefined {
  if (!range.from && !range.to) return undefined;
  const match: Record<string, Date> = {};
  if (range.from) match.$gte = range.from;
  if (range.to) match.$lte = range.to;
  return match;
}

export async function summarize(organisationId: string, range: DashboardRange): Promise<DashboardTotals> {
  // Model.aggregate() doesn't cast $match against the schema like find()
  // does, so a plain string here would never match the stored ObjectId.
  const match: Record<string, unknown> = { organisationId: new mongoose.Types.ObjectId(organisationId) };
  const dateFilter = dateMatch(range);
  if (dateFilter) match.date = dateFilter;

  // $sum over amountKobo (a Long) stays a 64-bit integer on the server;
  // useBigInt64 on the driver brings it back as bigint, not a double.
  const [totals] = await TransactionModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        inflowsKobo: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amountKobo', 0n] } },
        outflowsKobo: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amountKobo', 0n] } },
      },
    },
  ]);

  const spendingByCategory = await TransactionModel.aggregate([
    { $match: { ...match, direction: 'debit', 'category.value': { $ne: null } } },
    { $group: { _id: '$category.value', totalKobo: { $sum: '$amountKobo' } } },
    { $sort: { totalKobo: -1 } },
  ]);

  const pendingClassificationCount = await TransactionModel.countDocuments({
    organisationId,
    'classification.status': { $in: ['pending', 'processing'] },
  });

  return {
    inflowsKobo: totals?.inflowsKobo ?? 0n,
    outflowsKobo: totals?.outflowsKobo ?? 0n,
    spendingByCategory: spendingByCategory.map((row) => ({ category: row._id as Category, totalKobo: row.totalKobo as bigint })),
    pendingClassificationCount,
  };
}
