import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { appDb } from '../src/db/client.js';
import { withTenant } from '../src/db/tenant.js';
import { buildApp } from '../src/app.js';
import { createAccount, createOrganisation, createTransaction, createUser, db, uniqueEmail } from './fixtures.js';

async function loginAs(app: Express, email: string, password: string): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  return response.body.token as string;
}

describe('row-level security', () => {
  async function twoOrganisations() {
    const orgA = await createOrganisation('RLS Org A');
    const orgB = await createOrganisation('RLS Org B');
    const accountA = await createAccount(orgA.id, { name: 'A account' });
    const accountB = await createAccount(orgB.id, { name: 'B account' });
    return { orgA, orgB, accountA, accountB };
  }

  it('shows the app role nothing at all when no organisation is set', async () => {
    await twoOrganisations();
    await expect(appDb().account.findMany()).resolves.toEqual([]);
  });

  it("returns only the current organisation's rows even when the query has no organisation filter", async () => {
    const { orgA, accountA } = await twoOrganisations();
    const visible = await withTenant(orgA.id, (tx) => tx.account.findMany());
    expect(visible.map((account) => account.id)).toEqual([accountA.id]);
  });

  it('refuses to write a row for another organisation', async () => {
    const { orgA, orgB, accountB } = await twoOrganisations();
    await expect(
      withTenant(orgA.id, (tx) =>
        tx.transaction.create({
          data: {
            organisationId: orgB.id,
            accountId: accountB.id,
            externalReference: 'sneaky',
            amountKobo: 100n,
            direction: 'debit',
            narration: 'Written into someone else',
            date: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("won't let a transaction point at another organisation's account", async () => {
    const { orgA, accountB } = await twoOrganisations();
    await expect(
      createTransaction(orgA.id, { accountId: accountB.id, amountKobo: 100n, direction: 'debit', date: new Date() }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('database constraints', () => {
  it('rejects a zero amount', async () => {
    const org = await createOrganisation('Constraint Co');
    const account = await createAccount(org.id);
    await expect(
      createTransaction(org.id, { accountId: account.id, amountKobo: 0n, direction: 'debit', date: new Date() }),
    ).rejects.toThrow(/transactions_amount_kobo_positive/);
  });

  it('keeps the classification history append-only', async () => {
    const org = await createOrganisation('Append Only Co');
    const account = await createAccount(org.id);
    const tx = await createTransaction(org.id, { accountId: account.id, amountKobo: 100n, direction: 'debit', date: new Date() });
    const event = await db().classificationEvent.create({
      data: { organisationId: org.id, transactionId: tx.id, source: 'rule', provider: 'rules-engine', category: 'OTHER', confidence: 0.9, reason: 'r' },
    });

    await expect(db().classificationEvent.update({ where: { id: event.id }, data: { category: 'RENT' } })).rejects.toThrow(/append-only/);
    await expect(db().classificationEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });
});

describe('cross-organisation access', () => {
  it("returns 404, not the other organisation's account, for a resource outside the caller's org", async () => {
    const password = 'org-a-password-value';
    const orgA = await createOrganisation('Org A');
    const orgB = await createOrganisation('Org B');
    const emailA = uniqueEmail('org-a-user');
    await createUser(orgA.id, { email: emailA, password });
    const accountB = await createAccount(orgB.id, { name: "Org B's account" });

    const app = buildApp();
    const token = await loginAs(app, emailA, password);

    const response = await request(app)
      .get(`/api/v1/accounts/${accountB.id}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404, not a 500, for a malformed account id', async () => {
    const password = 'org-malformed-id-password';
    const org = await createOrganisation('Malformed Id Co');
    const email = uniqueEmail('malformed-id-user');
    await createUser(org.id, { email, password });

    const app = buildApp();
    const token = await loginAs(app, email, password);

    const response = await request(app)
      .get('/api/v1/accounts/not-an-object-id')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('returns a real account for a valid id in the caller\'s own organisation', async () => {
    const password = 'org-own-account-password';
    const org = await createOrganisation('Own Account Co');
    const email = uniqueEmail('own-account-user');
    await createUser(org.id, { email, password });
    const account = await createAccount(org.id, { name: 'My Own Account' });

    const app = buildApp();
    const token = await loginAs(app, email, password);

    const response = await request(app)
      .get(`/api/v1/accounts/${account.id}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: account.id, name: 'My Own Account' });
  });

  it('lists only the caller organisation\'s accounts', async () => {
    const password = 'org-c-password-value';
    const orgC = await createOrganisation('Org C');
    const orgD = await createOrganisation('Org D');
    const emailC = uniqueEmail('org-c-user');
    await createUser(orgC.id, { email: emailC, password });
    await createAccount(orgC.id, { name: "Org C's account" });
    await createAccount(orgD.id, { name: "Org D's account" });

    const app = buildApp();
    const token = await loginAs(app, emailC, password);

    const response = await request(app).get('/api/v1/accounts').set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const names = response.body.accounts.map((account: { name: string }) => account.name);
    expect(names).toEqual(["Org C's account"]);
  });
});
