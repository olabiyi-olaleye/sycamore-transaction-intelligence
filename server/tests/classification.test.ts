import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { TransactionModel } from '../src/models/transaction.model.js';
import { ReviewFlagModel, createFlag } from '../src/models/reviewFlag.model.js';
import { buildApp } from '../src/app.js';
import { processOneClaimedTransaction, resetCircuitBreakerForTests } from '../src/services/classification/classification.service.js';
import { setMockLlmFailureRate, setMockLlmMode } from '../src/services/classification/mockLlmProvider.js';
import { resetClassificationProvider, setClassificationProvider } from '../src/services/classification/providers.js';
import { ClassificationEventModel } from '../src/models/classificationEvent.model.js';
import { createAccount, createOrganisation, createTransaction, createUser, uniqueEmail } from './fixtures.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The worker's claim is deliberately global across every organisation, and
// this suite shares one persistent database with every other test file, so
// anything left `pending` by an earlier file is claimable here too. Draining
// the queue in 'ok' mode before each test (which always succeeds instantly)
// guarantees the next claim is whichever transaction *this* test just made.
async function drainQueue(): Promise<void> {
  setMockLlmMode('ok');
  setMockLlmFailureRate(0);
  for (let i = 0; i < 2000; i += 1) {
    const outcome = await processOneClaimedTransaction();
    if (outcome === 'empty') return;
  }
  throw new Error('drainQueue did not terminate; something is stuck retrying');
}

beforeEach(async () => {
  resetCircuitBreakerForTests();
  await drainQueue();
});

afterEach(() => {
  resetClassificationProvider();
  setMockLlmMode('ok');
  setMockLlmFailureRate(0);
  resetCircuitBreakerForTests();
});

async function setupOrgAndAccount() {
  const org = await createOrganisation('Classification Test Co');
  const account = await createAccount(org._id.toString());
  return { orgId: org._id.toString(), accountId: account._id.toString() };
}

describe('rules-based classification', () => {
  it('classifies a salary payment as PAYROLL via rules, without calling the AI provider', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 50000000n,
      direction: 'debit',
      narration: 'Monthly SALARY payment - March',
      date: new Date(),
    });

    setMockLlmMode('down'); // if this got called instead of a rule, the test would fail
    const outcome = await processOneClaimedTransaction();
    expect(outcome).toBe('claimed');

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('classified');
    expect(reread?.category?.value).toBe('PAYROLL');
    expect(reread?.category?.source).toBe('rule');
    expect(reread?.category?.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('AI classification and each mock failure mode', () => {
  it('classifies via the AI provider when no rule matches, in "ok" mode', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: 'Miscellaneous vendor payment xyz',
      date: new Date(),
    });

    setMockLlmMode('ok');
    await processOneClaimedTransaction();

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('classified');
    expect(reread?.category?.source).toBe('ai');
  });

  it('"down": the attempt fails, the transaction stays unclassified and is rescheduled', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: 'Miscellaneous vendor payment abc',
      date: new Date(),
    });

    setMockLlmMode('down');
    await processOneClaimedTransaction();

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('pending');
    expect(reread?.classification.attempts).toBe(1);
    expect(reread?.classification.lastError).toMatch(/unavailable/i);
    expect(reread?.classification.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('"rate_limited": the next attempt is scheduled using the provider\'s retry-after', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: 'Miscellaneous vendor payment def',
      date: new Date(),
    });

    const before = Date.now();
    setMockLlmMode('rate_limited');
    await processOneClaimedTransaction();

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('pending');
    expect(reread?.classification.lastError).toMatch(/rate limit/i);
    const delay = (reread?.classification.nextAttemptAt?.getTime() ?? 0) - before;
    expect(delay).toBeGreaterThan(1500);
    expect(delay).toBeLessThan(3000);
  });

  it('"invalid": a malformed provider response is rejected by Zod, not trusted', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: 'Miscellaneous vendor payment ghi',
      date: new Date(),
    });

    setMockLlmMode('invalid');
    await processOneClaimedTransaction();

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('pending');
    expect(reread?.classification.lastError).toMatch(/malformed/i);
  });

  it('"slow": a response past the 5s timeout is treated as a failure', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: 'Miscellaneous vendor payment jkl',
      date: new Date(),
    });

    setMockLlmMode('slow');
    await processOneClaimedTransaction();

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('pending');
    expect(reread?.classification.attempts).toBe(1);
  }, 10000);
});

describe('swapping the classification provider', () => {
  it('uses whichever provider is plugged in, with nothing else changed', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: `Campaign spend with an unknown agency ${Date.now()}`,
      date: new Date(),
    });

    setClassificationProvider({
      name: 'fake-vendor',
      async classify() {
        return { category: 'MARKETING', confidence: 0.88, reason: 'Fake vendor says marketing' };
      },
    });

    for (let i = 0; i < 30; i += 1) {
      const current = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
      if (current?.classification.status === 'classified') break;
      await processOneClaimedTransaction();
    }

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.category).toMatchObject({ value: 'MARKETING', source: 'ai', confidence: 0.88 });
    const event = await ClassificationEventModel.findOne({ organisationId: orgId, transactionId: tx._id }).lean();
    expect(event?.provider).toBe('fake-vendor');
  });
});

describe('giving up', () => {
  it('fails after 5 invalid responses and raises a CLASSIFICATION_FAILED flag', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: 'Miscellaneous vendor payment mno',
      date: new Date(),
      attempts: 4,
      invalidResponses: 4, // the answer about to come back will be the 5th bad one
    });

    setMockLlmMode('invalid');
    await processOneClaimedTransaction();

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('failed');
    expect(reread?.classification.invalidResponses).toBe(5);
    expect(reread?.reviewStatus).toBe('open');

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: tx._id }).lean();
    expect(flag?.type).toBe('CLASSIFICATION_FAILED');
    expect(flag?.status).toBe('open');
    expect(flag?.reason).toContain('5 times');
  });

  it('never gives up while the provider is down, however many attempts it has had', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 15000n,
      direction: 'debit',
      narration: 'Miscellaneous vendor payment during a long outage',
      date: new Date(),
      attempts: 40,
    });

    setMockLlmMode('down');
    await processOneClaimedTransaction();

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('pending');
    expect(reread?.classification.attempts).toBe(41);
    expect(reread?.classification.invalidResponses).toBe(0);
    // Backoff is capped at 60s (plus up to 25% jitter).
    const delay = (reread?.classification.nextAttemptAt?.getTime() ?? 0) - Date.now();
    expect(delay).toBeLessThanOrEqual(75_000);

    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: tx._id }).lean();
    expect(flag).toBeNull();
  });
});

describe('POST /api/v1/classification/retry-failed', () => {
  it("requeues this organisation's failed transactions, which then classify and clear their flag", async () => {
    const password = 'retry-failed-password';
    const org = await createOrganisation('Retry Failed Co');
    const orgId = org._id.toString();
    const email = uniqueEmail('retry-failed');
    await createUser(orgId, { email, password, role: 'admin' });
    const account = await createAccount(orgId);
    const tx = await createTransaction(orgId, {
      accountId: account._id.toString(),
      amountKobo: 15000n,
      direction: 'debit',
      narration: `Previously failed vendor payment ${Date.now()}`,
      date: new Date(),
      classificationStatus: 'failed',
      attempts: 5,
      invalidResponses: 5,
    });
    await createFlag(orgId, { transactionId: tx._id.toString(), type: 'CLASSIFICATION_FAILED', reason: 'r' });

    const otherOrg = await createOrganisation('Retry Failed Other Co');
    const otherAccount = await createAccount(otherOrg._id.toString());
    const otherTx = await createTransaction(otherOrg._id.toString(), {
      accountId: otherAccount._id.toString(),
      amountKobo: 15000n,
      direction: 'debit',
      date: new Date(),
      classificationStatus: 'failed',
    });

    const app = buildApp();
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const response = await request(app).post('/api/v1/classification/retry-failed').set('authorization', `Bearer ${login.body.token}`);
    expect(response.status).toBe(200);
    expect(response.body.requeued).toBe(1);

    const requeued = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(requeued?.classification).toMatchObject({ status: 'pending', attempts: 0, invalidResponses: 0 });
    const untouched = await TransactionModel.findOne({ organisationId: otherOrg._id, _id: otherTx._id }).lean();
    expect(untouched?.classification.status).toBe('failed');

    // A fixed, confident answer: the mock's confidence depends on the
    // narration, and a LOW_CONFIDENCE flag would keep reviewStatus 'open'.
    setClassificationProvider({
      name: 'fake-vendor',
      async classify() {
        return { category: 'OTHER', confidence: 0.9, reason: 'Fixed answer for this test' };
      },
    });
    for (let i = 0; i < 30; i += 1) {
      const current = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
      if (current?.classification.status === 'classified') break;
      await processOneClaimedTransaction();
    }

    const final = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(final?.classification.status).toBe('classified');
    expect(final?.reviewStatus).toBe('resolved');
    const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: tx._id, type: 'CLASSIFICATION_FAILED' }).lean();
    expect(flag?.status).toBe('resolved');
  });
});

describe('POST /api/v1/classification/retry-failed as a member', () => {
  it('returns 403 and requeues nothing', async () => {
    const password = 'retry-failed-member-password';
    const org = await createOrganisation('Retry Failed Member Co');
    const orgId = org._id.toString();
    const email = uniqueEmail('retry-failed-member');
    await createUser(orgId, { email, password, role: 'member' });
    const account = await createAccount(orgId);
    const tx = await createTransaction(orgId, { accountId: account._id.toString(), amountKobo: 15000n, direction: 'debit', date: new Date(), classificationStatus: 'failed' });

    const app = buildApp();
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const response = await request(app).post('/api/v1/classification/retry-failed').set('authorization', `Bearer ${login.body.token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('failed');
  });
});

describe('low-confidence classification', () => {
  it('raises a LOW_CONFIDENCE flag when the AI provider is unsure', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    // The mock LLM's confidence is a deterministic function of narration text;
    // this one happens to land under the 0.6 threshold.
    let flagged = false;
    for (let attempt = 0; attempt < 20 && !flagged; attempt += 1) {
      const narration = `Unclassifiable vendor charge seed-${attempt}`;
      const tx = await createTransaction(orgId, { accountId, amountKobo: 15000n, direction: 'debit', narration, date: new Date() });
      setMockLlmMode('ok');
      await processOneClaimedTransaction();
      const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
      if ((reread?.category?.confidence ?? 1) < 0.6) {
        const flag = await ReviewFlagModel.findOne({ organisationId: orgId, transactionId: tx._id }).lean();
        expect(flag?.type).toBe('LOW_CONFIDENCE');
        expect(flag?.reason).toContain('confidence');
        flagged = true;
      }
    }
    expect(flagged).toBe(true);
  });
});

describe('crashed worker recovery', () => {
  it('reclaims a transaction stuck "processing" with an expired lock', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    const tx = await createTransaction(orgId, {
      accountId,
      amountKobo: 50000000n,
      direction: 'debit',
      narration: 'Monthly SALARY payment - crashed worker case',
      date: new Date(),
      classificationStatus: 'processing',
      attempts: 1,
      lockedUntil: new Date(Date.now() - 1000), // expired a second ago
    });

    const outcome = await processOneClaimedTransaction();
    expect(outcome).toBe('claimed');

    const reread = await TransactionModel.findOne({ organisationId: orgId, _id: tx._id }).lean();
    expect(reread?.classification.status).toBe('classified');
    expect(reread?.classification.attempts).toBe(2);
  });

  it('does not reclaim a transaction whose lock has not expired yet', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    await createTransaction(orgId, {
      accountId,
      amountKobo: 50000000n,
      direction: 'debit',
      narration: 'Still locked, do not touch',
      date: new Date(),
      classificationStatus: 'processing',
      attempts: 1,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    const outcome = await processOneClaimedTransaction();
    expect(outcome).toBe('empty');
  });
});

describe('circuit breaker', () => {
  it('stops calling a consistently-down provider after 5 consecutive failures, while rules keep working', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    setMockLlmMode('down');

    for (let i = 0; i < 5; i += 1) {
      await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', narration: `Breaker warm-up ${i}`, date: new Date() });
    }
    for (let i = 0; i < 5; i += 1) {
      await processOneClaimedTransaction();
    }

    const sixth = await createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', narration: 'Breaker should trip here', date: new Date() });
    await processOneClaimedTransaction();
    const sixthReread = await TransactionModel.findOne({ organisationId: orgId, _id: sixth._id }).lean();
    expect(sixthReread?.classification.lastError).toMatch(/circuit breaker/i);
    // The skipped call never reached the provider, so it isn't counted, and
    // the retry waits until the 30s cool-off is over.
    expect(sixthReread?.classification.attempts).toBe(0);
    expect(sixthReread?.classification.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now() + 25_000);

    // Rules do not go through the breaker at all.
    const ruleTx = await createTransaction(orgId, { accountId, amountKobo: 50000000n, direction: 'debit', narration: 'SALARY payment while breaker is open', date: new Date() });
    await processOneClaimedTransaction();
    const ruleReread = await TransactionModel.findOne({ organisationId: orgId, _id: ruleTx._id }).lean();
    expect(ruleReread?.classification.status).toBe('classified');
    expect(ruleReread?.category?.source).toBe('rule');
  });
});

describe('ingestion does not depend on AI', () => {
  it('still returns 201 for a new import while the mock provider is down', async () => {
    setMockLlmMode('down');
    const password = 'classification-ingestion-password';
    const org = await createOrganisation('Ingestion During Outage Co');
    const email = uniqueEmail('ingestion-outage');
    await createUser(org._id.toString(), { email, password });
    const account = await createAccount(org._id.toString());

    const app = buildApp();
    const loginResponse = await request(app).post('/api/v1/auth/login').send({ email, password });
    const { token } = loginResponse.body;

    const response = await request(app)
      .post('/api/v1/transactions')
      .set('authorization', `Bearer ${token}`)
      .send({
        accountId: account._id.toString(),
        externalReference: 'outage-1',
        amount: '500.00',
        direction: 'debit',
        currency: 'NGN',
        narration: 'Import during outage',
        date: '2024-05-01',
      });

    expect(response.status).toBe(201);
    expect(response.body.classification.status).toBe('pending');
  });
});

describe('backlog drains once the provider recovers', () => {
  it('rows stuck pending during an outage all classify once the mode returns to ok', async () => {
    const { orgId, accountId } = await setupOrgAndAccount();
    setMockLlmMode('down');

    const created = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        createTransaction(orgId, { accountId, amountKobo: 1000n, direction: 'debit', narration: `Outage backlog row ${i}-${Date.now()}`, date: new Date() }),
      ),
    );

    // The claim queue is shared with leftovers from other tests, so a claim
    // may pick up someone else's row first. Keep claiming until each of ours
    // has had its failed attempt, rather than assuming the next 3 are ours.
    const ourIds = created.map((c) => c._id);
    for (let i = 0; i < 30; i += 1) {
      const untried = await TransactionModel.countDocuments({ organisationId: orgId, _id: { $in: ourIds }, 'classification.attempts': 0 });
      if (untried === 0) break;
      await processOneClaimedTransaction();
    }

    const afterOutage = await TransactionModel.find({ organisationId: orgId, _id: { $in: ourIds } }).lean();
    expect(afterOutage.every((tx) => tx.classification.status === 'pending')).toBe(true);
    // Nothing of ours is due again yet: the backoff hasn't elapsed.
    expect(afterOutage.every((tx) => (tx.classification.nextAttemptAt?.getTime() ?? 0) > Date.now())).toBe(true);

    setMockLlmMode('ok');
    await wait(2600); // past the first backoff window

    // Other test files' leftover retries can become due in the same window
    // and queue-jump ours (earlier nextAttemptAt claims first), so drain
    // through those too rather than assuming our 3 claims are next.
    const ids = created.map((c) => c._id);
    for (let i = 0; i < 30; i += 1) {
      const remaining = await TransactionModel.countDocuments({
        organisationId: orgId,
        _id: { $in: ids },
        'classification.status': { $ne: 'classified' },
      });
      if (remaining === 0) break;
      await processOneClaimedTransaction();
    }

    const final = await TransactionModel.find({ organisationId: orgId, _id: { $in: ids } }).lean();
    expect(final.every((tx) => tx.classification.status === 'classified')).toBe(true);
  }, 10000);
});
