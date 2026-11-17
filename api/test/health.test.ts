import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.js';

describe('GET /health', () => {
  it('reports ok and carries a request id once the database is connected', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: 'connected' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /docs', () => {
  it('serves the OpenAPI spec without requiring a token', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/docs' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.openapi).toBe('3.0.3');
    expect(body.paths['/transactions']).toBeDefined();
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
