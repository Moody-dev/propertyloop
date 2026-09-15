import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { KycStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-types';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  // ─── User ─────────────────────────────────────────────────────────────────

  /** Submit (or resubmit) KYC. Resubmitting resets the review back to PENDING. */
  async submit(userId: string, dto: SubmitKycDto) {
    const data = {
      fullName: dto.fullName,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      documentUrls: dto.documentUrls,
      selfieUrl: dto.selfieUrl,
      status: KycStatus.PENDING,
      rejectionReason: null,
      reviewedById: null,
      reviewedAt: null,
    };
    const submission = await this.prisma.kycSubmission.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data, submittedAt: new Date() },
    });
    this.alerts?.kycSubmitted(dto.fullName);
    return submission;
  }

  async getMine(userId: string) {
    const submission = await this.prisma.kycSubmission.findUnique({
      where: { userId },
    });
    // Surface a clean "not started" shape rather than 404 for an empty state.
    return submission ?? { status: 'NONE' as const };
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  async listForAdmin(status?: KycStatus) {
    return this.prisma.kycSubmission.findMany({
      where: status ? { status } : undefined,
      orderBy: { submittedAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });
  }

  async review(adminId: string, id: string, dto: ReviewKycDto) {
    const submission = await this.prisma.kycSubmission.findUnique({
      where: { id },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!submission) throw new NotFoundException('KYC submission not found');

    const status =
      dto.status === 'APPROVED' ? KycStatus.APPROVED : KycStatus.REJECTED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.kycSubmission.update({
        where: { id },
        data: {
          status,
          rejectionReason:
            status === KycStatus.REJECTED ? dto.rejectionReason : null,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });

      // On approval, flip the verified flag on the user's agent/vendor profile.
      if (status === KycStatus.APPROVED) {
        if (submission.user.role === Role.AGENT) {
          await tx.agentProfile.updateMany({
            where: { userId: submission.userId },
            data: { verified: true },
          });
        } else if (submission.user.role === Role.VENDOR) {
          await tx.vendorProfile.updateMany({
            where: { userId: submission.userId },
            data: { verified: true },
          });
        }
      }
      return rec;
    });

    const approved = status === KycStatus.APPROVED;
    void this.notifications.notify({
      userId: submission.userId,
      type: approved
        ? NotificationType.KYC_APPROVED
        : NotificationType.KYC_REJECTED,
      title: approved ? 'Identity verified' : 'Verification needs attention',
      body: approved
        ? 'Your identity has been verified.'
        : dto.rejectionReason ||
          'Your verification was not approved. Please resubmit.',
      data: { kycId: id },
    });

    return updated;
  }
}
