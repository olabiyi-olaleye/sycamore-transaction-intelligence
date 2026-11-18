import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config/env.js';

export type Db = InstanceType<typeof PrismaClient>;

function createClient(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

let app: Db | undefined;
let system: Db | undefined;

/**
 * Connects as sycamore_app, which row-level security applies to. Don't use
 * this directly for tenant data: go through withTenant() in tenant.ts, which
 * sets the organisation for the transaction first. Without it, every tenant
 * table looks empty.
 */
export function appDb(): Db {
  app ??= createClient(config.DATABASE_URL);
  return app;
}

/**
 * Connects as sycamore_system (BYPASSRLS). Only for work that has to span
 * organisations: the worker's claim query, the queue counts in GET /health,
 * finding a user by email at login, and seeding. Every use is commented at
 * the call site.
 */
export function systemDb(): Db {
  system ??= createClient(config.SYSTEM_DATABASE_URL);
  return system;
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await appDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDb(): Promise<void> {
  await Promise.all([app?.$disconnect(), system?.$disconnect()]);
  app = undefined;
  system = undefined;
}
