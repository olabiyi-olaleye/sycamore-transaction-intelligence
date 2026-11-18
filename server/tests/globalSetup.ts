import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Builds a fresh test database once per `npm test`: drop and recreate it,
// create the two app roles if they don't exist yet, apply every migration
// in order, and grant the roles access. Runs the migration SQL directly
// rather than via `prisma migrate`, so the tests only need a Postgres
// server, not the Prisma CLI. Needs a superuser connection in
// TEST_ADMIN_DATABASE_URL.

const migrationsDir = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));

function databaseName(url: string): string {
  return new URL(url).pathname.slice(1);
}

function rolePassword(url: string): string {
  return decodeURIComponent(new URL(url).password);
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export default async function setup(): Promise<void> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL!;
  const appUrl = process.env.DATABASE_URL!;
  const systemUrl = process.env.SYSTEM_DATABASE_URL!;
  const testDb = databaseName(appUrl);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDb}"`);
    // Roles belong to the whole server, not one database, so on the Docker
    // Postgres they already exist (with the passwords the API uses). Only
    // create them when they're missing; never change an existing password.
    for (const [role, extra, url] of [
      ['sycamore_app', 'NOBYPASSRLS', appUrl],
      ['sycamore_system', 'BYPASSRLS', systemUrl],
    ] as const) {
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (!exists.rowCount) {
        await admin.query(`CREATE ROLE ${role} WITH LOGIN ${extra} PASSWORD ${quoteLiteral(rolePassword(url))}`);
      }
    }
  } finally {
    await admin.end();
  }

  const adminOnTestDb = new URL(adminUrl);
  adminOnTestDb.pathname = `/${testDb}`;
  const owner = new pg.Client({ connectionString: adminOnTestDb.toString() });
  await owner.connect();
  try {
    const migrations = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrations) {
      await owner.query(readFileSync(`${migrationsDir}${migration}/migration.sql`, 'utf8'));
    }
    await owner.query(`
      GRANT USAGE ON SCHEMA public TO sycamore_app, sycamore_system;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sycamore_app, sycamore_system;
    `);
  } finally {
    await owner.end();
  }
}
