import argon2 from 'argon2';
import { config } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connection.js';
import { AccountModel } from '../db/models/account.model.js';
import { OrganisationModel } from '../db/models/organisation.model.js';
import { UserModel } from '../db/models/user.model.js';
import { importBatch } from '../modules/transactions/transactions.service.js';
import { SEED_ORGANISATIONS } from './data.js';
import { generateSeedRows } from './generateTransactions.js';

// Idempotent: organisations and users are upserted on a natural key (name,
// email) with $setOnInsert, so re-running never duplicates or overwrites
// them. Transactions go through the real import service
// (transactions.service.ts's importBatch), so re-running reports every row
// as a duplicate instead of creating anything new — the same guarantee the
// API gives any client that resends a batch.
async function main(): Promise<void> {
  await connectDb();
  const passwordHash = await argon2.hash(config.SEED_PASSWORD);

  for (const seedOrg of SEED_ORGANISATIONS) {
    const org = await OrganisationModel.findOneAndUpdate(
      { name: seedOrg.name },
      { $setOnInsert: { name: seedOrg.name, settings: { largePaymentMultiple: seedOrg.largePaymentMultiple } } },
      { upsert: true, new: true },
    );
    const organisationId = org._id.toString();

    for (const user of seedOrg.users) {
      await UserModel.findOneAndUpdate(
        { email: user.email },
        { $setOnInsert: { organisationId: org._id, email: user.email, passwordHash, name: user.name, role: user.role } },
        { upsert: true, new: true },
      );
    }

    const accountIdBySlug = new Map<string, string>();
    for (const account of seedOrg.accounts) {
      const doc = await AccountModel.findOneAndUpdate(
        { organisationId: org._id, accountNumberLast4: account.accountNumberLast4 },
        {
          $setOnInsert: {
            organisationId: org._id,
            name: account.name,
            bankName: account.bankName,
            accountNumberLast4: account.accountNumberLast4,
            currency: 'NGN',
          },
        },
        { upsert: true, new: true },
      );
      accountIdBySlug.set(account.slug, doc._id.toString());
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

  console.log('\nSeed users (password from SEED_PASSWORD / .env.example):');
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
