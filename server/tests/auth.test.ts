import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
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
    const response = await request(app).post('/api/v1/auth/login').send({ email, password });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.user).toMatchObject({ email, name: 'Ada', role: 'admin' });
  });

  it('rejects the wrong password with the same message as an unknown email', async () => {
    const app = buildApp();

    const wrongPassword = await request(app).post('/api/v1/auth/login').send({ email, password: 'not-the-password' });
    const unknownEmail = await request(app).post('/api/v1/auth/login').send({ email: uniqueEmail('nobody'), password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('rejects a malformed body with a validation error', async () => {
    const app = buildApp();
    const response = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/me', () => {
  it('requires a bearer token', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/me');
    expect(response.status).toBe(401);
  });

  it('returns the authenticated user for a valid token', async () => {
    const password = 'another-strong-password';
    const org = await createOrganisation('Me Route Co');
    const email = uniqueEmail('me-route');
    await createUser(org._id.toString(), { email, password, name: 'Bola', role: 'member' });

    const app = buildApp();
    const loginResponse = await request(app).post('/api/v1/auth/login').send({ email, password });
    const { token } = loginResponse.body;

    const meResponse = await request(app).get('/api/v1/me').set('authorization', `Bearer ${token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toMatchObject({ email, name: 'Bola', role: 'member' });
  });
});

describe('login rate limiting', () => {
  it('returns 429 after 5 attempts for the same ip+email within the window', async () => {
    const app = buildApp();
    const rateLimitedEmail = uniqueEmail('rate-limited');

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: rateLimitedEmail, password: 'whatever' });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('does not rate-limit a different email from the same caller', async () => {
    const app = buildApp();
    const sharedEmail = uniqueEmail('shared-ip-a');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/api/v1/auth/login').send({ email: sharedEmail, password: 'whatever' });
    }

    const otherEmail = uniqueEmail('shared-ip-b');
    const response = await request(app).post('/api/v1/auth/login').send({ email: otherEmail, password: 'whatever' });

    expect(response.status).toBe(401); // not 429 — a different account, not locked out by the first
  });
});
