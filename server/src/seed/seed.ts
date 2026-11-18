import argon2 from 'argon2';
import { config } from '../config/env.js';
import { disconnectDb, systemDb } from '../db/client.js';
import { importBatch } from '../services/transactions/transactions.service.js';
import { SEED_ORGANISATIONS } from './data.js';
import { generateSeedRows } from './generateTransactions.js';

// Organisations, users and accounts are upserted on a natural key (name,
// email, account number), so re-running never duplicates them. Creating
// them needs the system role, since there's no organisation to scope to
// yet. Transactions go through the real import service (importBatch) as the
// app role, so a re-run just reports every row as a duplicate, the same as
// any client resending a batch.
async function main(): Promise<void> {
  const db = systemDb();
  const passwordHash = await argon2.hash(config.SEED_PASSWORD);

  for (const seedOrg of SEED_ORGANISATIONS) {
    const org = await db.organisation.upsert({
      where: { name: seedOrg.name },
      update: {},
      create: { name: seedOrg.name, largePaymentMultiple: seedOrg.largePaymentMultiple },
    });
    const organisationId = org.id;

    for (const user of seedOrg.users) {
      await db.user.upsert({
        where: { email: user.email.toLowerCase() },
        update: {},
        create: { organisationId, email: user.email.toLowerCase(), passwordHash, name: user.name, role: user.role },
      });
    }

    const accountIdBySlug = new Map<string, string>();
    for (const account of seedOrg.accounts) {
      const saved = await db.account.upsert({
        where: { organisationId_accountNumberLast4: { organisationId, accountNumberLast4: account.accountNumberLast4 } },
        update: {},
        create: {
          organisationId,
          name: account.name,
          bankName: account.bankName,
          accountNumberLast4: account.accountNumberLast4,
          currency: 'NGN',
        },
      });
      accountIdBySlug.set(account.slug, saved.id);
    }

    const rows = generateSeedRows(seedOrg).map((row) => ({
      accountId: accountIdBySlug.get(row.accountSlug),
      externalReference: row.externalReference,
      amount: row.amount,
      direction: row.direction,
      currency: 'NGN' as const,
      narration: row.narration,
      merchant: row.merchant,
      date: row.date,
    }));

    const result = await importBatch(organisationId, rows);
    console.log(
      `${seedOrg.name}: ${result.summary.created} created, ${result.summary.duplicate} duplicate, ${result.summary.failed} failed (${rows.length} rows)`,
    );
    const failures = result.results.filter((r) => r.status === 'failed');
    if (failures.length > 0) {
      console.error('Unexpected seed failures:', failures);
      process.exitCode = 1;
    }
  }

  console.log('\nSeed users (password from SEED_PASSWORD in server/.env):');
  for (const seedOrg of SEED_ORGANISATIONS) {
    for (const user of seedOrg.users) {
      console.log(`  ${user.email}  (${seedOrg.name}, ${user.role})`);
    }
  }

  await disconnectDb();
}

main().catch((error) => {
  console.error('Seed failed', error);
  process.exit(1);
});
