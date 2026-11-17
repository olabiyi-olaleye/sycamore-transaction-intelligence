// Hand-maintained, not generated — routes call schema.parse() directly
// rather than going through Fastify's own validation, so there's no
// automatic pipeline from the Zod schemas to this file. Update both when
// either one changes.

const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'VALIDATION_ERROR' },
        message: { type: 'string' },
        details: {},
        requestId: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
};

const errorResponses = {
  400: { description: 'Validation error', content: { 'application/json': { schema: errorResponse } } },
  401: { description: 'Missing or invalid bearer token', content: { 'application/json': { schema: errorResponse } } },
  404: { description: 'Not found (including a resource outside the caller\'s organisation)', content: { 'application/json': { schema: errorResponse } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: errorResponse } } },
};

const categoryEnum = [
  'REVENUE', 'PAYROLL', 'SOFTWARE', 'MARKETING', 'TRAVEL', 'UTILITIES', 'RENT', 'TAX', 'TRANSFERS', 'BANKING_FEES', 'OTHER',
];

const transaction = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    accountId: { type: 'string' },
    externalReference: { type: 'string' },
    amount: { type: 'string', example: '12999.75', description: 'Decimal string; never a JSON number' },
    direction: { type: 'string', enum: ['credit', 'debit'] },
    currency: { type: 'string', enum: ['NGN'] },
    narration: { type: 'string' },
    merchant: { type: 'string', nullable: true },
    date: { type: 'string', format: 'date-time' },
    category: {
      type: 'object',
      nullable: true,
      properties: {
        value: { type: 'string', enum: categoryEnum },
        source: { type: 'string', enum: ['rule', 'ai', 'human'] },
        confidence: { type: 'number' },
      },
    },
    classification: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'processing', 'classified', 'failed'] },
        attempts: { type: 'integer' },
        lastError: { type: 'string', nullable: true },
      },
    },
    reviewStatus: { type: 'string', enum: ['none', 'open', 'resolved'] },
  },
};

const transactionDetail = {
  allOf: [
    transaction,
    {
      type: 'object',
      properties: {
        classificationHistory: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', enum: ['rule', 'ai', 'human'] },
              provider: { type: 'string' },
              category: { type: 'string', enum: categoryEnum },
              previousCategory: { type: 'string', enum: categoryEnum, nullable: true },
              confidence: { type: 'number', nullable: true },
              reason: { type: 'string' },
              actorUserId: { type: 'string', nullable: true },
              note: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        flags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['POSSIBLE_DUPLICATE', 'UNUSUALLY_LARGE', 'LOW_CONFIDENCE', 'CLASSIFICATION_FAILED'] },
              reason: { type: 'string' },
              status: { type: 'string', enum: ['open', 'resolved'] },
              createdAt: { type: 'string', format: 'date-time' },
              resolvedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        },
      },
    },
  ],
};

const bearerAuth = [{ bearerAuth: [] as string[] }];

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Sycamore Transaction Intelligence API',
    version: '1.0.0',
    description:
      'Multi-tenant transaction import, AI-assisted categorisation, and human review. ' +
      'organisationId always comes from the bearer token, never from the request.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: { transaction, transactionDetail },
  },
  paths: {
    '/auth/login': {
      post: {
        summary: 'Log in',
        description: 'Rate-limited per (ip, email). Returns a 1-hour access token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authenticated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string' },
                        name: { type: 'string' },
                        role: { type: 'string', enum: ['admin', 'member'] },
                        organisationId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: errorResponses[401],
          429: { description: 'Too many login attempts', content: { 'application/json': { schema: errorResponse } } },
        },
      },
    },
    '/me': {
      get: {
        summary: 'Current authenticated user',
        security: bearerAuth,
        responses: { 200: { description: 'OK' }, 401: errorResponses[401] },
      },
    },
    '/accounts': {
      get: {
        summary: 'List the caller organisation\'s accounts',
        security: bearerAuth,
        responses: { 200: { description: 'OK' }, 401: errorResponses[401] },
      },
    },
    '/accounts/{id}': {
      get: {
        summary: 'Get one account',
        security: bearerAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    '/transactions': {
      post: {
        summary: 'Import a single transaction',
        description:
          'Idempotent on (organisationId, accountId, externalReference). Same reference and same ' +
          'fields: 200 with the original. Same reference, different fields: 409.',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['accountId', 'externalReference', 'amount', 'direction', 'currency', 'narration', 'date'],
                properties: {
                  accountId: { type: 'string' },
                  externalReference: { type: 'string' },
                  amount: { type: 'string', example: '12999.75', description: 'Decimal string, max 2 decimal places. A JSON number is rejected.' },
                  direction: { type: 'string', enum: ['credit', 'debit'] },
                  currency: { type: 'string', enum: ['NGN'] },
                  narration: { type: 'string' },
                  merchant: { type: 'string', nullable: true },
                  date: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: transaction } } },
          200: { description: 'Duplicate of an existing transaction with identical fields', content: { 'application/json': { schema: transaction } } },
          400: errorResponses[400],
          401: errorResponses[401],
          404: { ...errorResponses[404], description: 'The account does not belong to the caller\'s organisation' },
          409: { ...errorResponses[409], description: 'Same reference, different fields' },
        },
      },
      get: {
        summary: 'List transactions',
        description: 'Keyset pagination on (date, _id). cursor is opaque; there is no offset/skip.',
        security: bearerAuth,
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          { name: 'accountId', in: 'query', schema: { type: 'string' } },
          { name: 'direction', in: 'query', schema: { type: 'string', enum: ['credit', 'debit'] } },
          { name: 'category', in: 'query', schema: { type: 'string', enum: categoryEnum } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'minAmount', in: 'query', schema: { type: 'string' } },
          { name: 'maxAmount', in: 'query', schema: { type: 'string' } },
          { name: 'reviewStatus', in: 'query', schema: { type: 'string', enum: ['none', 'open', 'resolved'] } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Full-text search over narration and merchant' },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    transactions: { type: 'array', items: transaction },
                    nextCursor: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          401: errorResponses[401],
        },
      },
    },
    '/transactions/batch': {
      post: {
        summary: 'Import up to 1000 transactions',
        description:
          'Every row validated independently; one bad row never fails the batch. Safe to resend in ' +
          'full: already-imported rows come back as duplicate, not failed.',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['transactions'],
                properties: {
                  transactions: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object' } },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Per-row outcome and a summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          index: { type: 'integer' },
                          status: { type: 'string', enum: ['created', 'duplicate', 'failed'] },
                          transactionId: { type: 'string' },
                          error: { type: 'string' },
                        },
                      },
                    },
                    summary: {
                      type: 'object',
                      properties: { created: { type: 'integer' }, duplicate: { type: 'integer' }, failed: { type: 'integer' } },
                    },
                  },
                },
              },
            },
          },
          400: errorResponses[400],
          401: errorResponses[401],
        },
      },
    },
    '/transactions/{id}': {
      get: {
        summary: 'Get one transaction, with classification history and review flags',
        security: bearerAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: transactionDetail } } },
          401: errorResponses[401],
          404: errorResponses[404],
        },
      },
    },
    '/transactions/{id}/corrections': {
      post: {
        summary: 'Manually correct a transaction\'s category',
        description:
          'Writes a human classification_events row and updates the transaction in one ' +
          'multi-document transaction. Resolves any open LOW_CONFIDENCE/CLASSIFICATION_FAILED flag ' +
          'on it. The original automated classification event is preserved, never edited.',
        security: bearerAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['category'],
                properties: { category: { type: 'string', enum: categoryEnum }, note: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: transactionDetail } } },
          400: errorResponses[400],
          401: errorResponses[401],
          404: errorResponses[404],
        },
      },
    },
    '/review/flags': {
      get: {
        summary: 'List review flags for the caller organisation',
        security: bearerAuth,
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'resolved'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: { 200: { description: 'OK' }, 401: errorResponses[401] },
      },
    },
    '/review/flags/{id}/resolve': {
      post: {
        summary: 'Resolve a review flag',
        security: bearerAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'OK' },
          401: errorResponses[401],
          404: errorResponses[404],
          409: { ...errorResponses[409], description: 'Flag is already resolved' },
        },
      },
    },
    '/dashboard/summary': {
      get: {
        summary: 'Dashboard totals for the caller organisation',
        security: bearerAuth,
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    inflows: { type: 'string' },
                    outflows: { type: 'string' },
                    net: { type: 'string' },
                    spendingByCategory: {
                      type: 'array',
                      items: { type: 'object', properties: { category: { type: 'string', enum: categoryEnum }, total: { type: 'string' } } },
                    },
                    pendingClassificationCount: { type: 'integer' },
                    openFlagCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          401: errorResponses[401],
        },
      },
    },
    '/health': {
      get: {
        summary: 'Liveness and database connectivity',
        responses: { 200: { description: 'ok' }, 503: { description: 'degraded' } },
      },
    },
  },
};
