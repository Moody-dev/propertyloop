import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppWaitlistDto } from './dto/create-app-waitlist.dto';

@Injectable()
export class AppWaitlistService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(dto: CreateAppWaitlistDto) {
    const email = dto.email.trim().toLowerCase();
    try {
      const entry = await this.prisma.appWaitlistEntry.create({
        data: {
          email,
          source: dto.source ?? 'homepage_cta',
        },
      });
      return { success: true, entry };
    } catch (err: unknown) {
      // P2002 → unique violation: the email is already on the list.
      // Treat as idempotent success rather than an error so the user
      // doesn't get a confusing message for a duplicate signup.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.appWaitlistEntry.findUnique({
          where: { email },
        });
        return { success: true, entry: existing, alreadySubscribed: true };
      }
      throw err;
    }
  }

  async list(options: { page?: number; limit?: number; search?: string }) {
    const page = options.page ?? 1;
    const limit = options.limit ?? 100;
    const skip = (page - 1) * limit;

    const where: Prisma.AppWaitlistEntryWhereInput = {};
    if (options.search) {
      where.email = { contains: options.search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.appWaitlistEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.appWaitlistEntry.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async remove(id: string) {
    await this.prisma.appWaitlistEntry.delete({ where: { id } });
    return { success: true };
  }

  async exportCsv(): Promise<string> {
    const entries = await this.prisma.appWaitlistEntry.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const header = 'email,source,createdAt,notifiedAt';
    const rows = entries.map((e) =>
      [
        e.email,
        e.source ?? '',
        e.createdAt.toISOString(),
        e.notifiedAt?.toISOString() ?? '',
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }
}

// Workaround for a quirk where some bundlers see `Prisma` only used as a
// runtime check. Re-export so the value isn't tree-shaken.
void Prisma;
