import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { UpdateReportDto } from './dto/update-report.dto';

// App Store guideline 1.2 requires a "timely response" to content reports —
// we commit to acting within 24 hours. That's only possible if someone
// actually sees the report, so every new report (manual or auto-filed by a
// block) emails the team immediately rather than waiting to be noticed in
// the admin panel.
const MODERATION_EMAIL = 'support.propertyloop@propertyloop.ng';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async create(dto: CreateReportDto, reporterId?: string) {
    const report = await this.prisma.report.create({
      data: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        ...(reporterId ? { reporterId } : {}),
      },
    });

    this.notifyModerators(report).catch((err) =>
      this.logger.error(`Report notification email failed: ${err.message}`),
    );

    return report;
  }

  private async notifyModerators(report: {
    id: string;
    targetType: string;
    targetId: string;
    reason: string;
  }) {
    await this.mailService.sendEmail({
      to: MODERATION_EMAIL,
      subject: `New content report — ${report.targetType} (act within 24h)`,
      text:
        `A new report was filed and needs review within 24 hours.\n\n` +
        `Type: ${report.targetType}\n` +
        `Target ID: ${report.targetId}\n` +
        `Reason: ${report.reason}\n` +
        `Report ID: ${report.id}\n\n` +
        `Review it in the admin panel under Reports.`,
      html:
        `<p>A new report was filed and needs review <strong>within 24 hours</strong>.</p>` +
        `<p><strong>Type:</strong> ${report.targetType}<br/>` +
        `<strong>Target ID:</strong> ${report.targetId}<br/>` +
        `<strong>Reason:</strong> ${report.reason}<br/>` +
        `<strong>Report ID:</strong> ${report.id}</p>` +
        `<p>Review it in the admin panel under Reports.</p>`,
    });
  }

  async list(dto: ListReportsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (dto.status) where.status = dto.status;
    if (dto.targetType) where.targetType = dto.targetType;

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          reporter: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async listMine(userId: string) {
    return this.prisma.report.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateReportDto) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');

    return this.prisma.report.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.adminNote !== undefined && { adminNote: dto.adminNote }),
      },
    });
  }
}
