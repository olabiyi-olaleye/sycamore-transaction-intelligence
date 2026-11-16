import { describe, expect, it } from 'vitest';
import { AccountModel } from '../src/db/models/account.model.js';
import { buildApp } from '../src/http/app.js';
import { createAccount, createOrganisation, createUser, uniqueEmail } from './fixtures.js';

async function loginAs(app: ReturnType<typeof buildApp>, email: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return response.json().token as string;
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

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accountB._id.toString()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
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

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const names = response.json().accounts.map((account: { name: string }) => account.name);
    expect(names).toEqual(["Org C's account"]);
  });
});
