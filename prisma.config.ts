import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations need a direct (non-pgbouncer) connection because pgbouncer
// in transaction mode doesn't support advisory locks. The runtime client
// in src/prisma/prisma.service.ts continues to use DATABASE_URL via the
// PrismaPg adapter for normal pooled queries.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  },
});
