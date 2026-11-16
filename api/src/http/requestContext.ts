import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  // Set once, from the verified JWT, in the auth hook. Absent on routes that
  // do not require auth (login, health, docs).
  readonly organisationId?: string;
  readonly userId?: string;
  readonly role?: 'admin' | 'member';
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error('getRequestContext() called outside of a request');
  }
  return context;
}

// The one function tenant repositories call for organisationId. Throws rather
// than returning undefined so a missing scope fails loudly, not silently.
export function requireOrganisationId(): string {
  const context = getRequestContext();
  if (!context.organisationId) {
    throw new Error('No organisationId in request context');
  }
  return context.organisationId;
}
