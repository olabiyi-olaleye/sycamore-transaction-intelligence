import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { AccountModel } from '../src/models/account.model.js';
import { buildApp } from '../src/app.js';
import { createAccount, createOrganisation, createUser, uniqueEmail } from './fixtures.js';

async function loginAs(app: Express, email: string, password: string): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  return response.body.token as string;
}

describe('tenant-guard Mongoose plugin', () => {
  it('throws on a find with no organisationId in the filter', async () => {
    await expect(AccountModel.find({})).rejects.toThrow(/organisationId/);
  });

  it('throws on an aggregate whose first stage does not $match organisationId', async () => {
    await expect(AccountModel.aggregate([{ $group: { _id: '$currency' } }])).rejects.toThrow(/organisationId/);
  });

  it('allows a find once organisationId is in the filter', async () => {
    const org = await createOrganisation('Plugin Happy Path Co');
    await createAccount(org._id.toString());
    await expect(AccountModel.find({ organisationId: org._id })).resolves.not.toThrow();
  });
});

describe('cross-organisation access', () => {
  it("returns 404, not the other organisation's account, for a resource outside the caller's org", async () => {
    const password = 'org-a-password-value';
    const orgA = await createOrganisation('Org A');
    const orgB = await createOrganisation('Org B');
    const emailA = uniqueEmail('org-a-user');
    await createUser(orgA._id.toString(), { email: emailA, password });
    const accountB = await createAccount(orgB._id.toString(), { name: "Org B's account" });

    const app = buildApp();
    const token = await loginAs(app, emailA, password);

    const response = await request(app)
      .get(`/api/v1/accounts/${accountB._id.toString()}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404, not a 500, for a malformed account id', async () => {
    const password = 'org-malformed-id-password';
    const org = await createOrganisation('Malformed Id Co');
    const email = uniqueEmail('malformed-id-user');
    await createUser(org._id.toString(), { email, password });

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
    await createUser(org._id.toString(), { email, password });
    const account = await createAccount(org._id.toString(), { name: 'My Own Account' });

    const app = buildApp();
    const token = await loginAs(app, email, password);

    const response = await request(app)
      .get(`/api/v1/accounts/${account._id.toString()}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: account._id.toString(), name: 'My Own Account' });
  });

  it('lists only the caller organisation\'s accounts', async () => {
    const password = 'org-c-password-value';
    const orgC = await createOrganisation('Org C');
    const orgD = await createOrganisation('Org D');
    const emailC = uniqueEmail('org-c-user');
    await createUser(orgC._id.toString(), { email: emailC, password });
    await createAccount(orgC._id.toString(), { name: "Org C's account" });
    await createAccount(orgD._id.toString(), { name: "Org D's account" });

    const app = buildApp();
    const token = await loginAs(app, emailC, password);

    const response = await request(app).get('/api/v1/accounts').set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const names = response.body.accounts.map((account: { name: string }) => account.name);
    expect(names).toEqual(["Org C's account"]);
  });
});
