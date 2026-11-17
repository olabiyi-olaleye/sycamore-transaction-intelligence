import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.js';
import { createOrganisation, createUser, uniqueEmail } from './fixtures.js';

describe('POST /api/v1/auth/login', () => {
  const password = 'correct-horse-battery-staple';
  let email: string;

  beforeAll(async () => {
    const org = await createOrganisation('Login Test Co');
    email = uniqueEmail('login');
    await createUser(org._id.toString(), { email, password, name: 'Ada', role: 'admin' });
  });

  it('returns a token and the user on correct credentials', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBeTypeOf('string');
    expect(body.user).toMatchObject({ email, name: 'Ada', role: 'admin' });
  });

  it('rejects the wrong password with the same message as an unknown email', async () => {
    const app = buildApp();

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'not-the-password' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: uniqueEmail('nobody'), password },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownEmail.json().error.message);
  });

  it('rejects a malformed body with a validation error', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/me', () => {
  it('requires a bearer token', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
  });

  it('returns the authenticated user for a valid token', async () => {
    const password = 'another-strong-password';
    const org = await createOrganisation('Me Route Co');
    const email = uniqueEmail('me-route');
    await createUser(org._id.toString(), { email, password, name: 'Bola', role: 'member' });

    const app = buildApp();
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { token } = loginResponse.json();

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({ email, name: 'Bola', role: 'member' });
  });
});

describe('login rate limiting', () => {
  it('returns 429 after 5 attempts for the same ip+email within the window', async () => {
    const app = buildApp();
    const rateLimitedEmail = uniqueEmail('rate-limited');

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: rateLimitedEmail, password: 'whatever' },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('does not rate-limit a different email from the same caller', async () => {
    const app = buildApp();
    const sharedEmail = uniqueEmail('shared-ip-a');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: sharedEmail, password: 'whatever' } });
    }

    const otherEmail = uniqueEmail('shared-ip-b');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: otherEmail, password: 'whatever' },
    });

    expect(response.statusCode).toBe(401); // not 429 — a different account, not locked out by the first
  });
});
