import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('reports ok and carries a request id once the database is connected', async () => {
    const app = buildApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', db: 'connected' });
    expect(response.headers['x-request-id']).toBeTruthy();
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
