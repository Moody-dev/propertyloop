import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // Ten for the server. A one-off script boots this same module and would
    // otherwise take ten more pooled slots from Supabase while the dev server
    // and production hold theirs — which exhausts the pooler and fails live
    // queries with an empty Prisma error. Scripts set DB_POOL_MAX=1.
    const poolMax = Number(process.env.DB_POOL_MAX) || 10;

    const pool = new Pool({
      connectionString: databaseUrl,
      max: poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const adapter = new PrismaPg(pool);

    super({
      adapter,
    } as any);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
