import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { createAccount, createOrganisation, createTransaction, createUser, uniqueEmail } from './fixtures.js';

async function setupOrgWithToken() {
  const password = 'read-api-test-password';
  const org = await createOrganisation('Read API Test Co');
  const email = uniqueEmail('read-api');
  await createUser(org._id.toString(), { email, password });
  const account = await createAccount(org._id.toString());

  const app = buildApp();
  const loginResponse = await request(app).post('/api/v1/auth/login').send({ email, password });
  const { token } = loginResponse.body;
  return { app, org, account, authHeader: `Bearer ${token}` };
}

const day = (n: number) => new Date(`2024-01-${String(n).padStart(2, '0')}T12:00:00.000Z`);

describe('GET /api/v1/transactions', () => {
  it('paginates by keyset cursor, newest first, with no gaps or repeats', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const accountId = account._id.toString();
    for (let n = 1; n <= 5; n += 1) {
      await createTransaction(account.organisationId.toString(), {
        accountId,
        amountKobo: 1000n * BigInt(n),
        direction: 'debit',
        date: day(n),
      });
    }

    const seenReferences: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await request(app)
        .get(`/api/v1/transactions?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        .set('authorization', authHeader);
      expect(response.status).toBe(200);
      seenReferences.push(...response.body.transactions.map((t: { externalReference: string }) => t.externalReference));
      cursor = response.body.nextCursor;
      if (!cursor) break;
    }

    expect(seenReferences.length).toBe(5);
    expect(new Set(seenReferences).size).toBe(5);

    const firstPage = await request(app).get('/api/v1/transactions?limit=5').set('authorization', authHeader);
    const dates = firstPage.body.transactions.map((t: { date: string }) => t.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it('filters by accountId, direction, category, reviewStatus and date range', async () => {
    const { app, org, account, authHeader } = await setupOrgWithToken();
    const otherAccount = await createAccount(org._id.toString(), { name: 'Second Account' });
    const orgId = org._id.toString();

    await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 50000n, direction: 'debit', date: day(5), category: { value: 'SOFTWARE', source: 'rule', confidence: 0.95 } });
    await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 70000n, direction: 'credit', date: day(10), reviewStatus: 'open' });
    await createTransaction(orgId, { accountId: otherAccount._id.toString(), amountKobo: 90000n, direction: 'debit', date: day(15) });

    const byAccount = await request(app).get(`/api/v1/transactions?accountId=${account._id}`).set('authorization', authHeader);
    expect(byAccount.body.transactions.length).toBe(2);

    const byDirection = await request(app).get('/api/v1/transactions?direction=credit').set('authorization', authHeader);
    expect(byDirection.body.transactions).toHaveLength(1);
    expect(byDirection.body.transactions[0].direction).toBe('credit');

    const byCategory = await request(app).get('/api/v1/transactions?category=SOFTWARE').set('authorization', authHeader);
    expect(byCategory.body.transactions).toHaveLength(1);

    const byReviewStatus = await request(app).get('/api/v1/transactions?reviewStatus=open').set('authorization', authHeader);
    expect(byReviewStatus.body.transactions).toHaveLength(1);

    const byDateRange = await request(app)
      .get(`/api/v1/transactions?from=${day(9).toISOString()}&to=${day(11).toISOString()}`)
      .set('authorization', authHeader);
    expect(byDateRange.body.transactions).toHaveLength(1);
    expect(byDateRange.body.transactions[0].amount).toBe('700.00');
  });

  it('filters by minAmount and maxAmount', async () => {
    const { app, org, account, authHeader } = await setupOrgWithToken();
    const orgId = org._id.toString();
    await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 10000n, direction: 'debit', date: day(1) });
    await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 500000n, direction: 'debit', date: day(2) });
    await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 5000000n, direction: 'debit', date: day(3) });

    const response = await request(app)
      .get('/api/v1/transactions?minAmount=1000.00&maxAmount=10000.00')
      .set('authorization', authHeader);

    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.transactions[0].amount).toBe('5000.00');
  });

  it('searches narration and merchant via q', async () => {
    const { app, org, account, authHeader } = await setupOrgWithToken();
    const orgId = org._id.toString();
    await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 10000n, direction: 'debit', date: day(1), narration: 'AWS hosting invoice' });
    await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 20000n, direction: 'debit', date: day(2), narration: 'Office rent', merchant: 'Landlord Ltd' });

    const response = await request(app).get('/api/v1/transactions?q=hosting').set('authorization', authHeader);
    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.transactions[0].narration).toContain('AWS');
  });
});

describe('GET /api/v1/transactions?q= with a reference', () => {
  it('matches a pasted reference exactly instead of running a text search', async () => {
    const { app, account, authHeader } = await setupOrgWithToken();
    const orgId = account.organisationId.toString();
    const accountId = account._id.toString();
    await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', date: day(10), externalReference: 'TRF/0012' });
    await createTransaction(orgId, { accountId, amountKobo: 2000n, direction: 'debit', date: day(11), externalReference: 'TRF/0013' });

    const response = await request(app).get(`/api/v1/transactions?q=${encodeURIComponent('TRF/0012')}`).set('authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.transactions.map((t: { externalReference: string }) => t.externalReference)).toEqual(['TRF/0012']);
  });
});

describe('GET /api/v1/transactions/:id', () => {
  it('returns the transaction with empty classification history and flags for now', async () => {
    const { app, org, account, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(org._id.toString(), { accountId: account._id.toString(), amountKobo: 10000n, direction: 'debit', date: day(1) });

    const response = await request(app).get(`/api/v1/transactions/${tx._id}`).set('authorization', authHeader);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: tx._id.toString(), classificationHistory: [], flags: [] });
  });

  it('returns 404 for an id from another organisation', async () => {
    const { app, authHeader } = await setupOrgWithToken();
    const otherOrg = await createOrganisation('Other Org For Detail');
    const otherAccount = await createAccount(otherOrg._id.toString());
    const otherTx = await createTransaction(otherOrg._id.toString(), { accountId: otherAccount._id.toString(), amountKobo: 1000n, direction: 'debit', date: day(1) });

    const response = await request(app).get(`/api/v1/transactions/${otherTx._id}`).set('authorization', authHeader);
    expect(response.status).toBe(404);
  });

  it('returns 404, not a 500, for a malformed id', async () => {
    const { app, authHeader } = await setupOrgWithToken();
    const response = await request(app).get('/api/v1/transactions/not-an-object-id').set('authorization', authHeader);
    expect(response.status).toBe(404);
  });
});

describe('GET /api/v1/dashboard/summary', () => {
  it('computes inflows, outflows, net and spending by category exactly, with no float drift', async () => {
    const { app, org, account, authHeader } = await setupOrgWithToken();
    const orgId = org._id.toString();
    const accountId = account._id.toString();

    await createTransaction(orgId, { accountId, amountKobo: 150000075n, direction: 'credit', date: day(1) }); // 1,500,000.75
    await createTransaction(orgId, { accountId, amountKobo: 25000n, direction: 'debit', date: day(2), category: { value: 'SOFTWARE', source: 'rule', confidence: 0.9 } }); // 250.00
    await createTransaction(orgId, { accountId, amountKobo: 75000n, direction: 'debit', date: day(3), category: { value: 'SOFTWARE', source: 'rule', confidence: 0.9 } }); // 750.00
    await createTransaction(orgId, { accountId, amountKobo: 1000000n, direction: 'debit', date: day(4), category: { value: 'RENT', source: 'human', confidence: 1 } }); // 10,000.00
    await createTransaction(orgId, { accountId, amountKobo: 5000n, direction: 'debit', date: day(5), classificationStatus: 'pending' }); // 50.00, still pending

    const response = await request(app).get('/api/v1/dashboard/summary').set('authorization', authHeader);
    expect(response.status).toBe(200);

    expect(response.body.inflows).toBe('1500000.75');
    expect(response.body.outflows).toBe('11050.00');
    expect(response.body.net).toBe('1488950.75');
    expect(response.body.pendingClassificationCount).toBeGreaterThanOrEqual(1);

    const software = response.body.spendingByCategory.find((row: { category: string }) => row.category === 'SOFTWARE');
    const rent = response.body.spendingByCategory.find((row: { category: string }) => row.category === 'RENT');
    expect(software.total).toBe('1000.00');
    expect(rent.total).toBe('10000.00');
  });

  it('respects the from/to range', async () => {
    const { app, org, account, authHeader } = await setupOrgWithToken();
    const orgId = org._id.toString();
    const accountId = account._id.toString();
    await createTransaction(orgId, { accountId, amountKobo: 10000n, direction: 'credit', date: day(1) });
    await createTransaction(orgId, { accountId, amountKobo: 999999900n, direction: 'credit', date: day(20) });

    const response = await request(app)
      .get(`/api/v1/dashboard/summary?from=${day(1).toISOString()}&to=${day(5).toISOString()}`)
      .set('authorization', authHeader);

    expect(response.body.inflows).toBe('100.00');
  });

  it("never includes another organisation's totals", async () => {
    const { app, org, account, authHeader } = await setupOrgWithToken();
    await createTransaction(org._id.toString(), { accountId: account._id.toString(), amountKobo: 10000n, direction: 'credit', date: day(1) });

    const otherOrg = await createOrganisation('Dashboard Other Org');
    const otherAccount = await createAccount(otherOrg._id.toString());
    await createTransaction(otherOrg._id.toString(), { accountId: otherAccount._id.toString(), amountKobo: 999999999n, direction: 'credit', date: day(1) });

    const response = await request(app).get('/api/v1/dashboard/summary').set('authorization', authHeader);
    expect(response.body.inflows).toBe('100.00');
  });
});
