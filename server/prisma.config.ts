import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations run as the database owner (MIGRATE_DATABASE_URL), not as the
// app or system roles the API and worker connect with. Those roles can read
// and write rows but can't change the schema.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? '',
  },
});
