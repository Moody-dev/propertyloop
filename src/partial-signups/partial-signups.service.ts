import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartialSignupDto } from './dto/create-partial-signup.dto';

@Injectable()
export class PartialSignupsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record (or refresh) a half-finished signup. Called on every email-field
   * blur, so it must be idempotent — hence the upsert on the unique email.
   *
   * Someone who already has an account is skipped: they have nothing to be
   * followed up about, and we hold their details on User already. The caller
   * returns 204 either way, so this never reveals whether an email is
   * registered.
   */
  async capture(dto: CreatePartialSignupDto): Promise<void> {
    const email = dto.email.trim().toLowerCase();

    const registered = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (registered) return;

    // Only overwrite optional fields we actually received — a later blur on a
    // half-typed form must not wipe a name captured on an earlier one.
    const details = {
      ...(dto.name?.trim() && { name: dto.name.trim() }),
      ...(dto.phone?.trim() && { phone: dto.phone.trim() }),
      ...(dto.role && { role: dto.role }),
      ...(dto.step && { step: dto.step }),
      ...(dto.source && { source: dto.source }),
    };

    await this.prisma.partialSignup.upsert({
      where: { email },
      create: { email, ...details },
      update: details,
    });
  }

  /**
   * Stop following someone up once they register. Best-effort by design: this
   * runs inside signup, and a bookkeeping failure must never cost a new user
   * their account. updateMany (not update) so a missing row is a no-op rather
   * than a P2025 throw — most signups never abandoned anything.
   */
  async markCompleted(email: string): Promise<void> {
    await this.prisma.partialSignup.updateMany({
      where: { email: email.trim().toLowerCase(), completedAt: null },
      data: { completedAt: new Date() },
    });
  }

  async list(options: {
    page?: number;
    limit?: number;
    search?: string;
    pendingOnly?: boolean;
  }) {
    const page = options.page ?? 1;
    const limit = options.limit ?? 100;
    const skip = (page - 1) * limit;

    const where: Prisma.PartialSignupWhereInput = {};
    if (options.search) {
      where.email = { contains: options.search, mode: 'insensitive' };
    }
    if (options.pendingOnly) where.completedAt = null;

    const [items, total] = await Promise.all([
      this.prisma.partialSignup.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.partialSignup.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async remove(id: string) {
    await this.prisma.partialSignup.delete({ where: { id } });
    return { success: true };
  }

  /** Only the ones still worth chasing — completed rows are dead weight here. */
  async exportCsv(): Promise<string> {
    const entries = await this.prisma.partialSignup.findMany({
      where: { completedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const header = 'email,name,phone,role,step,source,createdAt';
    const rows = entries.map((e) =>
      [
        e.email,
        csvCell(e.name),
        csvCell(e.phone),
        e.role ?? '',
        e.step ?? '',
        e.source ?? '',
        e.createdAt.toISOString(),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }
}

/** Names arrive as free text and routinely contain commas and quotes. */
function csvCell(value: string | null): string {
  if (!value) return '';
  return `"${value.replace(/"/g, '""')}"`;
}
