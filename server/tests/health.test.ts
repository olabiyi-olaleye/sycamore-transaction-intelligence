import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { createAccount, createOrganisation, createTransaction } from './fixtures.js';

describe('GET /health', () => {
  it('reports ok and carries a request id once the database is connected', async () => {
    const app = buildApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', db: 'connected' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('reports the classification queue, including how long the oldest due row has waited', async () => {
    const org = await createOrganisation('Health Queue Co');
    const account = await createAccount(org._id.toString());
    await createTransaction(org._id.toString(), {
      accountId: account._id.toString(),
      amountKobo: 1000n,
      direction: 'debit',
      date: new Date(),
      classificationStatus: 'pending',
      nextAttemptAt: new Date(Date.now() - 10 * 60 * 1000), // due ten minutes ago
    });

    const response = await request(buildApp()).get('/health');

    const queue = response.body.classificationQueue;
    expect(queue.pending).toBeGreaterThanOrEqual(1);
    expect(typeof queue.processing).toBe('number');
    expect(typeof queue.failed).toBe('number');
    expect(queue.oldestDueSeconds).toBeGreaterThanOrEqual(600);
  });
});

describe('GET /docs', () => {
  it('serves the OpenAPI spec without requiring a token', async () => {
    const app = buildApp();
    const response = await request(app).get('/docs');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.paths['/transactions']).toBeDefined();
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const app = buildApp();
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
