import { formatKoboAsAmount } from '../utils/money.js';
import type { SeedOrganisation } from './data.js';

export interface SeedTransactionRow {
  accountSlug: string;
  externalReference: string;
  amount: string;
  direction: 'credit' | 'debit';
  narration: string;
  merchant: string | null;
  date: string;
}

const MONTHS = [
  { label: 'January', num: 1 },
  { label: 'February', num: 2 },
  { label: 'March', num: 3 },
];
const WEEK_COUNT = 13; // 2024-01-01 (a Monday) through 2024-03-31

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoDate(month: number, day: number): string {
  return `2024-${pad(month)}-${pad(day)}`;
}

function weekStart(weekIndex: number): Date {
  return new Date(Date.UTC(2024, 0, 1 + weekIndex * 7));
}

function addDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

// Quick hash so the same seed key always jitters to the same amount, which keeps
// re-running the seed script reproducible without a random seed library.
function djb2(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return hash >>> 0;
}

function jitteredAmount(baseKobo: number, seedKey: string, spread = 0.15): string {
  const hash = djb2(seedKey);
  const unit = (hash % 1000) / 1000; // 0..0.999, deterministic
  const factor = 1 + (unit - 0.5) * 2 * spread;
  const kobo = Math.max(1, Math.round(baseKobo * factor));
  return formatKoboAsAmount(BigInt(kobo));
}

function pick<T>(items: T[], seedKey: string): T {
  const hash = djb2(seedKey);
  return items[hash % items.length]!;
}

export function generateSeedRows(org: SeedOrganisation): SeedTransactionRow[] {
  const rows: SeedTransactionRow[] = [];
  const operating = org.accounts.find((a) => a.role === 'operating')!;
  const payroll = org.accounts.find((a) => a.role === 'payroll')!;
  const reserve = org.accounts.find((a) => a.role === 'reserve');
  const { profile } = org;

  for (const { label, num } of MONTHS) {
    const monthKey = isoDate(num, 1);

    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-rent-${monthKey}`,
      amount: jitteredAmount(profile.monthlyRentKobo, `${operating.slug}-rent-${num}`, 0.02),
      direction: 'debit',
      narration: `Rent payment - office, ${label}`,
      merchant: null,
      date: isoDate(num, 1),
    });
    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-ikedc-${monthKey}`,
      amount: jitteredAmount(45_000_00, `${operating.slug}-ikedc-${num}`),
      direction: 'debit',
      narration: `IKEDC electricity bill - ${label}`,
      merchant: 'IKEDC',
      date: isoDate(num, 4),
    });
    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-internet-${monthKey}`,
      amount: jitteredAmount(18_000_00, `${operating.slug}-internet-${num}`, 0.05),
      direction: 'debit',
      narration: `Internet subscription - ${label}`,
      merchant: 'MainOne',
      date: isoDate(num, 5),
    });
    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-vat-${monthKey}`,
      amount: jitteredAmount(220_000_00, `${operating.slug}-vat-${num}`, 0.3),
      direction: 'debit',
      narration: `VAT remittance to FIRS - ${label}`,
      merchant: null,
      date: isoDate(num, 21),
    });
    for (const vendor of profile.softwareVendors) {
      rows.push({
        accountSlug: operating.slug,
        externalReference: `${operating.slug}-software-${vendor.toLowerCase()}-${monthKey}`,
        amount: jitteredAmount(65_000_00, `${operating.slug}-software-${vendor}-${num}`, 0.1),
        direction: 'debit',
        narration: `${vendor} subscription charge`,
        merchant: vendor,
        date: isoDate(num, 7),
      });
    }

    // Payroll funding transfer: debit on operating, matching credit on payroll.
    const fundingAmount = jitteredAmount(profile.monthlySalaryKobo + profile.monthlySalaryKobo * 0.12, `${org.name}-funding-${num}`, 0.01);
    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-payrollfunding-${monthKey}`,
      amount: fundingAmount,
      direction: 'debit',
      narration: 'Transfer to own account - payroll funding',
      merchant: null,
      date: isoDate(num, 24),
    });
    rows.push({
      accountSlug: payroll.slug,
      externalReference: `${payroll.slug}-payrollfunding-${monthKey}`,
      amount: fundingAmount,
      direction: 'credit',
      narration: 'Transfer from Operating Account - payroll funding',
      merchant: null,
      date: isoDate(num, 24),
    });
    rows.push({
      accountSlug: payroll.slug,
      externalReference: `${payroll.slug}-salary-${monthKey}`,
      amount: jitteredAmount(profile.monthlySalaryKobo, `${payroll.slug}-salary-${num}`, 0.03),
      direction: 'debit',
      narration: `Monthly SALARY payment - ${label} payroll`,
      merchant: null,
      date: isoDate(num, 25),
    });
    rows.push({
      accountSlug: payroll.slug,
      externalReference: `${payroll.slug}-paye-${monthKey}`,
      amount: jitteredAmount(profile.monthlySalaryKobo * 0.12, `${payroll.slug}-paye-${num}`, 0.02),
      direction: 'debit',
      narration: `PAYE remittance to FIRS - ${label}`,
      merchant: null,
      date: isoDate(num, 26),
    });

    if (reserve) {
      rows.push({
        accountSlug: reserve.slug,
        externalReference: `${reserve.slug}-topup-${monthKey}`,
        amount: jitteredAmount(300_000_00, `${reserve.slug}-topup-${num}`, 0.1),
        direction: 'credit',
        narration: 'Transfer from Operating Account - reserve top-up',
        merchant: null,
        date: isoDate(num, 28),
      });
      rows.push({
        accountSlug: reserve.slug,
        externalReference: `${reserve.slug}-fee-${monthKey}`,
        amount: jitteredAmount(2_500_00, `${reserve.slug}-fee-${num}`, 0.1),
        direction: 'debit',
        narration: 'Card maintenance fee',
        merchant: null,
        date: isoDate(num, 28),
      });
    }
  }

  for (let week = 0; week < WEEK_COUNT; week += 1) {
    const monday = weekStart(week);

    for (let i = 0; i < 6; i += 1) {
      const customer = pick(profile.customers, `${operating.slug}-customer-${week}-${i}`);
      rows.push({
        accountSlug: operating.slug,
        externalReference: `${operating.slug}-receipt-w${week}-${i}`,
        amount: jitteredAmount(300_000_00, `${operating.slug}-receipt-${week}-${i}`, 0.5),
        direction: 'credit',
        narration: `Payment received from ${customer}`,
        merchant: customer,
        date: addDays(monday, i % 7),
      });
    }

    for (let i = 0; i < 4; i += 1) {
      const supplier = pick(profile.suppliers, `${operating.slug}-supplier-${week}-${i}`);
      rows.push({
        accountSlug: operating.slug,
        externalReference: `${operating.slug}-supplier-w${week}-${i}`,
        amount: jitteredAmount(200_000_00, `${operating.slug}-supplier-${week}-${i}`, 0.4),
        direction: 'debit',
        narration: `Payment to ${supplier} for supplies`,
        merchant: supplier,
        date: addDays(monday, (2 + i) % 7),
      });
    }

    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-fee-nip-w${week}`,
      amount: jitteredAmount(1_500_00, `${operating.slug}-fee-nip-${week}`, 0.2),
      direction: 'debit',
      narration: 'NIP CHARGE - outward transfer fee',
      merchant: null,
      date: addDays(monday, 5),
    });
    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-fee-stampduty-w${week}`,
      amount: '50.00',
      direction: 'debit',
      narration: 'Stamp duty on electronic transfer',
      merchant: null,
      date: addDays(monday, 6),
    });
  }

  // None of these match a rules.ts keyword on purpose, so they fall through
  // to the mock LLM.
  const vagueNarrations = ['Payment ref 44719', 'Settlement batch XK-220', 'Misc disbursement', 'Value adjustment entry 7'];
  vagueNarrations.forEach((narration, index) => {
    rows.push({
      accountSlug: operating.slug,
      externalReference: `${operating.slug}-vague-${index}`,
      amount: jitteredAmount(85_000_00, `${operating.slug}-vague-${index}`, 0.6),
      direction: 'debit',
      narration,
      merchant: null,
      date: isoDate(((index % 3) + 1), 15),
    });
  });

  // A duplicate payment pair for the POSSIBLE_DUPLICATE detector: same
  // amount and account, different reference, same date.
  const duplicateSupplier = profile.suppliers[0]!;
  rows.push({
    accountSlug: operating.slug,
    externalReference: `${operating.slug}-dup-a`,
    amount: '325750.00',
    direction: 'debit',
    narration: `Payment to ${duplicateSupplier} for supplies`,
    merchant: duplicateSupplier,
    date: '2024-02-14',
  });
  rows.push({
    accountSlug: operating.slug,
    externalReference: `${operating.slug}-dup-b`,
    amount: '325750.00',
    direction: 'debit',
    narration: `Payment to ${duplicateSupplier} for supplies`,
    merchant: duplicateSupplier,
    date: '2024-02-14',
  });

  // One unusually large debit for UNUSUALLY_LARGE, dated in March so the
  // account already has well over 10 prior debits in its trailing 90 days.
  rows.push({
    accountSlug: operating.slug,
    externalReference: `${operating.slug}-large-emergency`,
    amount: '3250000.00',
    direction: 'debit',
    narration: 'Emergency equipment purchase',
    merchant: null,
    date: '2024-03-18',
  });

  return rows;
}
