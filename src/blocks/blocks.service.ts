import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { ReportTargetType } from '../../generated/prisma/client';
import { CreateBlockDto } from './dto/create-block.dto';

@Injectable()
export class BlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
  ) {}

  /**
   * Block another user. Instant and one-sided: hides their content from the
   * blocker (conversations, listings, profile) and stops them contacting the
   * blocker again. Also auto-files a USER report so the team reviews the
   * blocked account — App Store guideline 1.2 requires blocking to notify
   * the developer of the inappropriate content, not just hide it silently.
   */
  async block(blockerId: string, dto: CreateBlockDto) {
    if (dto.userId === blockerId) {
      throw new BadRequestException('You cannot block yourself');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    await this.prisma.blockedUser.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId: dto.userId } },
      create: { blockerId, blockedId: dto.userId, reason: dto.reason },
      update: { reason: dto.reason },
    });

    await this.reportsService.create(
      {
        targetType: ReportTargetType.USER,
        targetId: dto.userId,
        reason: dto.reason?.trim()
          ? `Blocked by another user. Reason given: ${dto.reason.trim()}`
          : 'Blocked by another user (no reason given).',
      },
      blockerId,
    );

    return { success: true };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.blockedUser.deleteMany({
      where: { blockerId, blockedId },
    });
    return { success: true };
  }

  async listBlocked(blockerId: string) {
    const rows = await this.prisma.blockedUser.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: { select: { id: true, name: true, avatarUrl: true, role: true } },
      },
    });
    return rows.map((r) => ({
      id: r.blocked.id,
      name: r.blocked.name,
      avatarUrl: r.blocked.avatarUrl,
      role: r.blocked.role,
      blockedAt: r.createdAt,
    }));
  }
}
