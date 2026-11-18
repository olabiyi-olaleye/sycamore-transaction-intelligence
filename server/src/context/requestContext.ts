import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  // Set once, from the verified JWT, in auth.middleware.ts. Absent on routes
  // that don't require auth (login, health, docs).
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

/** For the logger: the current request's context if there is one, otherwise undefined. */
export function tryGetRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

// Throws instead of returning undefined, so a missing organisationId is an
// error at the point of use, not a silent null a service forgets to check.
export function requireOrganisationId(): string {
  const context = getRequestContext();
  if (!context.organisationId) {
    throw new Error('No organisationId in request context');
  }
  return context.organisationId;
}
