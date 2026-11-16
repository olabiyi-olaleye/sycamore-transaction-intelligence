import { describe, expect, it } from 'vitest';
import { TransactionModel } from '../src/db/models/transaction.model.js';
import { buildApp } from '../src/http/app.js';
import { createAccount, createOrganisation, createUser, uniqueEmail } from './fixtures.js';

async function setupOrgWithToken() {
  const password = 'ingestion-test-password';
  const org = await createOrganisation('Ingestion Test Co');
  const email = uniqueEmail('ingestion');
  await createUser(org._id.toString(), { email, password });
  const account = await createAccount(org._id.toString());

  const app = buildApp();
  const loginResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const { token } = loginResponse.json();
  return { app, org, account, token, authHeader: { authorization: `Bearer ${token}` } };
}

function baseRow(accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    accountId,
    externalReference: `ref-${Math.random().toString(36).slice(2)}`,
    amount: '12999.75',
    direction: 'debit',
    currency: 'NGN',
    narration: 'Office supplies',
    merchant: 'Konga',
    date: '2024-03-15',
    ...overrides,
  };
}

describe('POST /api/v1/transactions', () => {
  it('creates a transaction and returns 201', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authHeader,
      payload: baseRow(account._id.toString()),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.amount).toBe('12999.75');
    expect(body.direction).toBe('debit');
    expect(body.classification.status).toBe('pending');
  });

  it('rejects a JSON number for amount with an explanatory message', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authHeader,
      payload: baseRow(account._id.toString(), { amount: 12999.75 }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects three decimal places', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authHeader,
      payload: baseRow(account._id.toString(), { amount: '100.001' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns the original with 200 when the same reference is imported twice with identical fields', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const row = baseRow(account._id.toString());

    const first = await app.inject({ method: 'POST', url: '/api/v1/transactions', headers: authHeader, payload: row });
    const second = await app.inject({ method: 'POST', url: '/api/v1/transactions', headers: authHeader, payload: row });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
  });

  it('returns 409 when the same reference is imported again with different fields', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const row = baseRow(account._id.toString());

    const first = await app.inject({ method: 'POST', url: '/api/v1/transactions', headers: authHeader, payload: row });
    const conflicting = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authHeader,
      payload: { ...row, amount: '1.00' },
    });

    expect(first.statusCode).toBe(201);
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe('CONFLICT');
  });

  it("returns 404 for a transaction imported against another organisation's account", async () => {
    const { app, authHeader } = await setupOrgWithToken();
    const otherOrg = await createOrganisation('Someone Else Co');
    const otherAccount = await createAccount(otherOrg._id.toString());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authHeader,
      payload: baseRow(otherAccount._id.toString()),
    });

    expect(response.statusCode).toBe(404);
  });

  it('creates exactly one document for 20 concurrent imports of the same reference', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const row = baseRow(account._id.toString());

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({ method: 'POST', url: '/api/v1/transactions', headers: authHeader, payload: row }),
      ),
    );

    const created = responses.filter((response) => response.statusCode === 201);
    const duplicates = responses.filter((response) => response.statusCode === 200);
    expect(created.length).toBe(1);
    expect(duplicates.length).toBe(19);

    const count = await TransactionModel.countDocuments({
      organisationId: account.organisationId,
      accountId: account._id,
      externalReference: row.externalReference,
    });
    expect(count).toBe(1);
  });
});

describe('POST /api/v1/transactions/batch', () => {
  it('reports created, duplicate and failed rows with a matching summary', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const existingRow = baseRow(account._id.toString());
    await app.inject({ method: 'POST', url: '/api/v1/transactions', headers: authHeader, payload: existingRow });

    const otherOrg = await createOrganisation('Not My Org');
    const otherAccount = await createAccount(otherOrg._id.toString());

    const repeatedRef = `batch-dup-${Math.random().toString(36).slice(2)}`;
    const batch = [
      baseRow(account._id.toString()), // created
      existingRow, // duplicate: already in the database
      baseRow(account._id.toString(), { externalReference: repeatedRef }), // created
      baseRow(account._id.toString(), { externalReference: repeatedRef }), // duplicate: repeats row 2 in this batch
      baseRow(otherAccount._id.toString()), // failed: not this organisation's account
      baseRow(account._id.toString(), { amount: 'not-a-number' }), // failed: validation
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/batch',
      headers: authHeader,
      payload: { transactions: batch },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toEqual({ created: 2, duplicate: 2, failed: 2 });
    expect(body.results.map((row: { status: string }) => row.status)).toEqual([
      'created',
      'duplicate',
      'created',
      'duplicate',
      'failed',
      'failed',
    ]);
  });

  it('is safe to resend in full: every row becomes a duplicate on the second attempt', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const batch = [baseRow(account._id.toString()), baseRow(account._id.toString())];

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/batch',
      headers: authHeader,
      payload: { transactions: batch },
    });
    const resend = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/batch',
      headers: authHeader,
      payload: { transactions: batch },
    });

    expect(first.json().summary).toEqual({ created: 2, duplicate: 0, failed: 0 });
    expect(resend.json().summary).toEqual({ created: 0, duplicate: 2, failed: 0 });

    const count = await TransactionModel.countDocuments({ organisationId: account.organisationId, accountId: account._id });
    expect(count).toBe(2);
  });

  it('rejects an empty batch and a batch over 1000 rows', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/batch',
      headers: authHeader,
      payload: { transactions: [] },
    });
    const tooLarge = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/batch',
      headers: authHeader,
      payload: { transactions: Array.from({ length: 1001 }, () => baseRow(account._id.toString())) },
    });

    expect(empty.statusCode).toBe(400);
    expect(tooLarge.statusCode).toBe(400);
  });
});

describe('amountKobo round trip through MongoDB', () => {
  it('stores and reads back a value above Number.MAX_SAFE_INTEGER as a bigint, unchanged', async () => {
    const { account } = await setupOrgWithToken();
    const hugeKobo = 9007199254740999n; // above Number.MAX_SAFE_INTEGER (9_007_199_254_740_991)

    const created = await TransactionModel.create({
      organisationId: account.organisationId,
      accountId: account._id,
      externalReference: `huge-${Math.random().toString(36).slice(2)}`,
      amountKobo: hugeKobo,
      direction: 'credit',
      currency: 'NGN',
      narration: 'Large capital injection',
      merchant: null,
      date: new Date('2024-01-01'),
    });

    const reread = await TransactionModel.findOne({ organisationId: account.organisationId, _id: created._id }).lean();
    expect(typeof reread?.amountKobo).toBe('bigint');
    expect(reread?.amountKobo).toBe(hugeKobo);
  });
});
