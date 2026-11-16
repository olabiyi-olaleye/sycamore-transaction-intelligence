import type { Schema } from 'mongoose';

// Mongoose query middleware names that can read or write a tenant collection
// without going through 'save' or 'aggregate'.
const QUERY_HOOKS = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndRemove',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

// The worker's claim query is the only place in the app that legitimately
// queries a tenant collection across every organisation at once (it has to:
// it is looking for whichever organisation's transaction is due next). It
// opts out with `.setOptions({ [TENANT_GUARD_BYPASS]: true })`, commented at
// the call site. Nothing else may use this.
export const TENANT_GUARD_BYPASS = 'bypassTenantGuard';

interface QueryLike {
  getOptions(): Record<string, unknown>;
  getFilter(): Record<string, unknown>;
  op?: string;
  model: { modelName: string };
}

interface AggregateLike {
  options?: Record<string, unknown>;
  pipeline(): Array<Record<string, { organisationId?: unknown }>>;
  model(): { modelName: string };
}

/**
 * Throws if a query, update or aggregate against this schema's collection has
 * no organisationId in its filter. This is a backstop, not the primary
 * defence: repositories are expected to pass organisationId on every call,
 * but a mistake there would otherwise leak data across organisations.
 */
export function tenantScopePlugin(schema: Schema): void {
  schema.pre(QUERY_HOOKS as unknown as 'find', function (this: QueryLike, next: (err?: Error) => void) {
    const options = this.getOptions();
    if (options[TENANT_GUARD_BYPASS]) {
      next();
      return;
    }
    const filter = this.getFilter();
    if (!filter.organisationId) {
      next(
        new Error(`Refusing unscoped ${this.op ?? 'query'} on ${this.model.modelName}: organisationId missing from filter`),
      );
      return;
    }
    next();
  });

  schema.pre('aggregate' as unknown as 'find', function (this: unknown, next: (err?: Error) => void) {
    const self = this as AggregateLike;
    if (self.options?.[TENANT_GUARD_BYPASS]) {
      next();
      return;
    }
    const [firstStage] = self.pipeline();
    const scopedByFirstMatch = Boolean(firstStage?.$match?.organisationId);
    if (!scopedByFirstMatch) {
      next(
        new Error(`Refusing unscoped aggregate on ${self.model().modelName}: first pipeline stage must $match organisationId`),
      );
      return;
    }
    next();
  });

  schema.pre('save', function (next: (err?: Error) => void) {
    if (this.isNew && !this.get('organisationId')) {
      next(new Error(`Refusing to save a ${this.constructor.name} without organisationId`));
      return;
    }
    next();
  });

  schema.pre('insertMany', function (next: (err?: Error) => void, docs: unknown) {
    const rows = Array.isArray(docs) ? docs : [docs];
    const missing = rows.some((doc) => !(doc as Record<string, unknown> | undefined)?.organisationId);
    if (missing) {
      next(new Error('Refusing insertMany with a document missing organisationId'));
      return;
    }
    next();
  });
}
