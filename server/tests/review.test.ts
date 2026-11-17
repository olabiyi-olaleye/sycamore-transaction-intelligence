import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ClassificationEventModel } from '../src/models/classificationEvent.model.js';
import { ReviewFlagModel, createFlag } from '../src/models/reviewFlag.model.js';
import { TransactionModel } from '../src/models/transaction.model.js';
import { buildApp } from '../src/app.js';
import { detectPossibleDuplicate, detectUnusuallyLarge } from '../src/services/review/detectors.js';
import { createAccount, createOrganisation, createTransaction, createUser, uniqueEmail } from './fixtures.js';

async function setupOrgWithToken() {
  const password = 'review-test-password';
  const org = await createOrganisation('Review Test Co');
  const email = uniqueEmail('review');
  const user = await createUser(org._id.toString(), { email, password });
  const account = await createAccount(org._id.toString());

  const app = buildApp();
  const loginResponse = await request(app).post('/api/v1/auth/login').send({ email, password });
  const { token } = loginResponse.body;
  return { app, orgId: org._id.toString(), accountId: account._id.toString(), userId: user._id.toString(), authHeader: `Bearer ${token}` };
}

const day = (n: number) => new Date(`2024-02-${String(n).padStart(2, '0')}T12:00:00.000Z`);

describe('POSSIBLE_DUPLICATE detector', () => {
  it('flags the same amount paid from the same account within 24 hours under a different reference', async () => {
    const { orgId, accountId } = await setupOrgWithToken();
    const first = await createTransaction(orgId, { accountId, amountKobo: 25000000n, direction: 'debit', date: new Date('2024-02-10T09:00:00.000Z'), externalReference: 'GTB-88213' });
    const second = await createTransaction(orgId, { accountId, amountKobo: 25000000n, direction: 'debit', date: new Date('2024-02-10T12:00:00.000Z'), externalReference: 'GTB-99001' });

    await detectPossibleDuplicate(orgId, second);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: second._id }).lean();
    expect(flag?.type).toBe('POSSIBLE_DUPLICATE');
    expect(flag?.reason).toContain('250,000.00');
    expect(flag?.reason).toContain('GTB-88213');
    expect(flag?.reason).toMatch(/hours? earlier/);

    // The earlier one is not itself flagged as a duplicate of something later.
    const firstFlag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: first._id }).lean();
    expect(firstFlag).toBeNull();
  });

  it('does not flag the same amount more than 24 hours apart', async () => {
    const { orgId, accountId } = await setupOrgWithToken();
    await createTransaction(orgId, { accountId, amountKobo: 25000000n, direction: 'debit', date: new Date('2024-02-10T09:00:00.000Z') });
    const second = await createTransaction(orgId, { accountId, amountKobo: 25000000n, direction: 'debit', date: new Date('2024-02-12T09:00:00.000Z') });

    await detectPossibleDuplicate(orgId, second);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: second._id }).lean();
    expect(flag).toBeNull();
  });

  it('does not flag a different amount within the same 24 hours', async () => {
    const { orgId, accountId } = await setupOrgWithToken();
    await createTransaction(orgId, { accountId, amountKobo: 25000000n, direction: 'debit', date: new Date('2024-02-10T09:00:00.000Z') });
    const second = await createTransaction(orgId, { accountId, amountKobo: 30000000n, direction: 'debit', date: new Date('2024-02-10T12:00:00.000Z') });

    await detectPossibleDuplicate(orgId, second);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: second._id }).lean();
    expect(flag).toBeNull();
  });
});

describe('UNUSUALLY_LARGE detector', () => {
  it("flags a debit above the account's large-payment multiple, given at least 10 prior debits", async () => {
    const { orgId, accountId } = await setupOrgWithToken();
    for (let i = 1; i <= 10; i += 1) {
      await createTransaction(orgId, { accountId, amountKobo: 50000000n, direction: 'debit', date: day(i) }); // ₦500,000 each
    }
    const large = await createTransaction(orgId, { accountId, amountKobo: 450000000n, direction: 'debit', date: day(20) }); // ₦4,500,000 = 9x

    await detectUnusuallyLarge(orgId, large);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: large._id }).lean();
    expect(flag?.type).toBe('UNUSUALLY_LARGE');
    expect(flag?.reason).toBe("₦4,500,000.00 is 9x this account's typical debit of ₦500,000.00.");
  });

  it('does not flag a large debit with fewer than 10 prior debits', async () => {
    const { orgId, accountId } = await setupOrgWithToken();
    for (let i = 1; i <= 5; i += 1) {
      await createTransaction(orgId, { accountId, amountKobo: 50000000n, direction: 'debit', date: day(i) });
    }
    const large = await createTransaction(orgId, { accountId, amountKobo: 450000000n, direction: 'debit', date: day(20) });

    await detectUnusuallyLarge(orgId, large);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: large._id }).lean();
    expect(flag).toBeNull();
  });

  it('does not flag a debit that is not above the multiple', async () => {
    const { orgId, accountId } = await setupOrgWithToken();
    for (let i = 1; i <= 10; i += 1) {
      await createTransaction(orgId, { accountId, amountKobo: 50000000n, direction: 'debit', date: day(i) });
    }
    const notLarge = await createTransaction(orgId, { accountId, amountKobo: 100000000n, direction: 'debit', date: day(20) }); // 2x, below the 5x default

    await detectUnusuallyLarge(orgId, notLarge);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: notLarge._id }).lean();
    expect(flag).toBeNull();
  });

  it('does not flag a credit no matter how large', async () => {
    const { orgId, accountId } = await setupOrgWithToken();
    for (let i = 1; i <= 10; i += 1) {
      await createTransaction(orgId, { accountId, amountKobo: 50000000n, direction: 'debit', date: day(i) });
    }
    const credit = await createTransaction(orgId, { accountId, amountKobo: 999999999n, direction: 'credit', date: day(20) });

    await detectUnusuallyLarge(orgId, credit);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: credit._id }).lean();
    expect(flag).toBeNull();
  });
});

describe('GET /api/v1/review/flags', () => {
  it('lists only this organisation\'s flags, filterable by status', async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const txA = await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', date: day(1) });
    const txB = await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', date: day(2) });
    await ReviewFlagModel.create({ organisationId: orgId, transactionId: txA._id, type: 'LOW_CONFIDENCE', reason: 'r1' });
    await ReviewFlagModel.create({ organisationId: orgId, transactionId: txB._id, type: 'CLASSIFICATION_FAILED', reason: 'r2', status: 'resolved', resolvedAt: new Date() });

    const otherOrg = await createOrganisation('Other Review Org');
    const otherAccount = await createAccount(otherOrg._id.toString());
    const otherTx = await createTransaction(otherOrg._id.toString(), { accountId: otherAccount._id.toString(), amountKobo: 1000n, direction: 'debit', date: day(1) });
    await ReviewFlagModel.create({ organisationId: otherOrg._id, transactionId: otherTx._id, type: 'LOW_CONFIDENCE', reason: 'not mine' });

    const all = await request(app).get('/api/v1/review/flags').set('authorization', authHeader);
    expect(all.body.flags).toHaveLength(2);

    const openOnly = await request(app).get('/api/v1/review/flags?status=open').set('authorization', authHeader);
    expect(openOnly.body.flags).toHaveLength(1);
    expect(openOnly.body.flags[0].type).toBe('LOW_CONFIDENCE');
  });
});

describe('POST /api/v1/review/flags/:id/resolve', () => {
  it('resolves an open flag', async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', date: day(1) });
    const flag = await ReviewFlagModel.create({ organisationId: orgId, transactionId: tx._id, type: 'LOW_CONFIDENCE', reason: 'r' });

    const response = await request(app).post(`/api/v1/review/flags/${flag._id}/resolve`).set('authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('resolved');
  });

  it('returns 409 for a flag that is already resolved', async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', date: day(1) });
    const flag = await ReviewFlagModel.create({ organisationId: orgId, transactionId: tx._id, type: 'LOW_CONFIDENCE', reason: 'r', status: 'resolved', resolvedAt: new Date() });

    const response = await request(app).post(`/api/v1/review/flags/${flag._id}/resolve`).set('authorization', authHeader);
    expect(response.status).toBe(409);
  });

  it("returns 404 for another organisation's flag", async () => {
    const { app, authHeader } = await setupOrgWithToken();
    const otherOrg = await createOrganisation('Resolve Other Org');
    const otherAccount = await createAccount(otherOrg._id.toString());
    const otherTx = await createTransaction(otherOrg._id.toString(), { accountId: otherAccount._id.toString(), amountKobo: 1000n, direction: 'debit', date: day(1) });
    const flag = await ReviewFlagModel.create({ organisationId: otherOrg._id, transactionId: otherTx._id, type: 'LOW_CONFIDENCE', reason: 'r' });

    const response = await request(app).post(`/api/v1/review/flags/${flag._id}/resolve`).set('authorization', authHeader);
    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/transactions/:id/corrections', () => {
  it('preserves the original classification and records who corrected it and when', async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      date: day(1),
      category: { value: 'MARKETING', source: 'ai', confidence: 0.42 },
      classificationStatus: 'classified',
    });
    await ClassificationEventModel.create({
      organisationId: orgId,
      transactionId: tx._id,
      source: 'ai',
      provider: 'mock-llm',
      category: 'MARKETING',
      previousCategory: null,
      confidence: 0.42,
      reason: 'Mock LLM inferred MARKETING',
    });
    await ReviewFlagModel.create({ organisationId: orgId, transactionId: tx._id, type: 'LOW_CONFIDENCE', reason: 'Categorised as Marketing with 42% confidence.' });

    const response = await request(app)
      .post(`/api/v1/transactions/${tx._id}/corrections`)
      .set('authorization', authHeader)
      .send({ category: 'SOFTWARE', note: 'This is clearly a software subscription' });

    expect(response.status).toBe(200);
    expect(response.body.category).toMatchObject({ value: 'SOFTWARE', source: 'human' });

    const history = response.body.classificationHistory;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ source: 'ai', category: 'MARKETING' });
    expect(history[1]).toMatchObject({ source: 'human', category: 'SOFTWARE', previousCategory: 'MARKETING', note: 'This is clearly a software subscription' });

    // The original AI event is untouched, not edited.
    const originalEvent = await ClassificationEventModel.findOne({ organisationId: orgId, transactionId: tx._id, source: 'ai' }).lean();
    expect(originalEvent?.category).toBe('MARKETING');

    // The LOW_CONFIDENCE flag is resolved by the correction.
    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: tx._id, type: 'LOW_CONFIDENCE' }).lean();
    expect(flag?.status).toBe('resolved');

    expect(response.body.flags.find((f: { type: string }) => f.type === 'LOW_CONFIDENCE').status).toBe('resolved');
  });

  it('moves classification.status to classified so the worker cannot overwrite a correction', async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      date: day(1),
      classificationStatus: 'failed',
    });

    await request(app)
      .post(`/api/v1/transactions/${tx._id}/corrections`)
      .set('authorization', authHeader)
      .send({ category: 'OTHER' });

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('classified');
  });

  it("returns 404 for another organisation's transaction", async () => {
    const { app, authHeader } = await setupOrgWithToken();
    const otherOrg = await createOrganisation('Correction Other Org');
    const otherAccount = await createAccount(otherOrg._id.toString());
    const otherTx = await createTransaction(otherOrg._id.toString(), { accountId: otherAccount._id.toString(), amountKobo: 1000n, direction: 'debit', date: day(1) });

    const response = await request(app)
      .post(`/api/v1/transactions/${otherTx._id}/corrections`)
      .set('authorization', authHeader)
      .send({ category: 'OTHER' });

    expect(response.status).toBe(404);
  });
});

describe('transaction.reviewStatus follows its flags', () => {
  it("moves to 'open' when a flag is raised and shows up in the reviewStatus filter", async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', date: day(3) });

    await createFlag(orgId, { transactionId: tx._id.toString(), type: 'LOW_CONFIDENCE', reason: 'r' });

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.reviewStatus).toBe('open');

    const listed = await request(app).get('/api/v1/transactions?reviewStatus=open').set('authorization', authHeader);
    expect(listed.body.transactions.map((t: { id: string }) => t.id)).toContain(tx._id.toString());
  });

  it("stays 'open' until the last open flag is resolved, then moves to 'resolved'", async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', date: day(4) });
    await createFlag(orgId, { transactionId: tx._id.toString(), type: 'LOW_CONFIDENCE', reason: 'r1' });
    await createFlag(orgId, { transactionId: tx._id.toString(), type: 'UNUSUALLY_LARGE', reason: 'r2' });
    const flags = await ReviewFlagModel.find({ organisationId: orgId, transactionId: tx._id }).lean();

    await request(app).post(`/api/v1/review/flags/${flags[0]!._id}/resolve`).set('authorization', authHeader);
    let reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.reviewStatus).toBe('open');

    await request(app).post(`/api/v1/review/flags/${flags[1]!._id}/resolve`).set('authorization', authHeader);
    reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.reviewStatus).toBe('resolved');
  });

  it("moves to 'resolved' when a correction clears the only open flag", async () => {
    const { app, orgId, accountId, authHeader } = await setupOrgWithToken();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      date: day(5),
      category: { value: 'MARKETING', source: 'ai', confidence: 0.42 },
      classificationStatus: 'classified',
    });
    await createFlag(orgId, { transactionId: tx._id.toString(), type: 'LOW_CONFIDENCE', reason: 'r' });

    await request(app).post(`/api/v1/transactions/${tx._id}/corrections`).set('authorization', authHeader).send({ category: 'SOFTWARE' });

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.reviewStatus).toBe('resolved');
  });
});
