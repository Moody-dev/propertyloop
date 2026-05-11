import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from './paystack.service';
import {
  EscrowStatus,
  JobStatus,
  SubscriptionTier,
  SubscriptionStatus,
  ListingStatus,
} from '../../generated/prisma/client';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private paystackService: PaystackService,
    private configService: ConfigService,
  ) {}

  async initializeJobPayment(
    jobId: string,
    buyerEmail: string,
  ): Promise<{ paymentUrl: string; reference: string }> {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (job.escrowStatus !== EscrowStatus.NONE) {
      throw new BadRequestException(
        'Payment has already been initiated for this job',
      );
    }

    const amountKobo = job.escrowAmount * 100;
    const reference = `PLJOB-${jobId}-${Date.now()}`;
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const callbackUrl = `${frontendUrl}/payment-callback?jobId=${jobId}`;

    try {
      const { authorization_url } =
        await this.paystackService.initializeTransaction({
          email: buyerEmail,
          amount: amountKobo,
          reference,
          callback_url: callbackUrl,
          metadata: { jobId, type: 'vendor_job' },
        });

      // Store reference in job
      await this.prisma.vendorJob.update({
        where: { id: jobId },
        data: { escrowId: reference },
      });

      return { paymentUrl: authorization_url, reference };
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to initialize payment: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async handleChargeSuccess(reference: string): Promise<void> {
    // Idempotent — find job and only update if escrowStatus === NONE
    const job = await this.prisma.vendorJob.findUnique({
      where: { escrowId: reference },
    });

    if (!job) {
      console.warn(`Webhook: Job not found for reference ${reference}`);
      return;
    }

    if (job.escrowStatus !== EscrowStatus.NONE) {
      // Already processed
      return;
    }

    try {
      // Verify payment amount with Paystack
      const txn = await this.paystackService.verifyTransaction(reference);
      if (txn.status !== 'success') {
        console.warn(
          `Payment verification failed: ${txn.status} for ${reference}`,
        );
        return;
      }

      const expectedAmountKobo = job.escrowAmount * 100;
      if (txn.amount !== expectedAmountKobo) {
        console.warn(
          `Amount mismatch: expected ${expectedAmountKobo}, got ${txn.amount} for ${reference}`,
        );
        return;
      }

      // Lock escrow
      await this.prisma.vendorJob.update({
        where: { id: job.id },
        data: {
          escrowStatus: EscrowStatus.LOCKED,
          escrowPaidAt: new Date(),
        },
      });

      console.log(`Escrow LOCKED for job ${job.id} via reference ${reference}`);
    } catch (error: any) {
      console.error(
        `Error handling charge.success webhook for ${reference}:`,
        error.message,
      );
    }
  }

  async releaseEscrow(jobId: string, buyerUserId: string): Promise<void> {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (job.buyerUserId !== buyerUserId) {
      throw new BadRequestException('Only the buyer can release escrow');
    }
    if (job.status !== JobStatus.COMPLETED) {
      throw new BadRequestException(
        'Job must be completed before releasing escrow',
      );
    }
    if (job.escrowStatus !== EscrowStatus.LOCKED) {
      throw new BadRequestException('Escrow is not locked');
    }

    // Fetch vendor's bank account
    const bankAccount = await this.prisma.vendorBankAccount.findUnique({
      where: { vendorUserId: job.vendorUserId },
    });

    if (!bankAccount) {
      throw new BadRequestException(
        'Vendor has not set up a bank account for payouts. Contact the vendor.',
      );
    }

    try {
      const vendorFeeKobo = job.vendorFee * 100;
      const transferReference = `PLPAY-${jobId}-${Date.now()}`;

      const { transfer_code } = await this.paystackService.initiateTransfer({
        source: 'balance',
        amount: vendorFeeKobo,
        recipient: bankAccount.paystackRecipientCode,
        reason: `Payment for job: ${job.title}`,
        reference: transferReference,
      });

      // Update job — set status to PAID and escrowStatus to RELEASED (optimistic)
      await this.prisma.vendorJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.PAID,
          escrowStatus: EscrowStatus.RELEASED,
          confirmedAt: new Date(),
          transferCode: transfer_code,
        },
      });

      console.log(
        `Escrow RELEASED for job ${jobId}, transfer initiated: ${transfer_code}`,
      );
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to release escrow: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async handleTransferSuccess(transferCode: string): Promise<void> {
    const job = await this.prisma.vendorJob.findFirst({
      where: { transferCode },
    });

    if (!job) {
      console.warn(`Webhook: Job not found for transfer code ${transferCode}`);
      return;
    }

    try {
      // Create VendorEarning to mark the payment as PAID
      await this.prisma.vendorEarning.upsert({
        where: { jobId: job.id },
        create: {
          vendorUserId: job.vendorUserId,
          jobId: job.id,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.vendorFee,
          status: 'PAID',
          paidAt: new Date(),
        },
        update: {
          status: 'PAID',
          paidAt: new Date(),
        },
      });

      console.log(`Vendor earning recorded for job ${job.id}`);
    } catch (error: any) {
      console.error(
        `Error handling transfer.success webhook for ${transferCode}:`,
        error.message,
      );
    }
  }

  async resolveDisputeRelease(jobId: string): Promise<void> {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (job.escrowStatus !== EscrowStatus.DISPUTED) {
      throw new BadRequestException('Job is not in disputed state');
    }

    // Admin override — call releaseEscrow without buyer check
    const bankAccount = await this.prisma.vendorBankAccount.findUnique({
      where: { vendorUserId: job.vendorUserId },
    });

    if (!bankAccount) {
      throw new BadRequestException(
        'Vendor has not set up a bank account for payouts',
      );
    }

    try {
      const vendorFeeKobo = job.vendorFee * 100;
      const transferReference = `PLPAY-${jobId}-${Date.now()}`;

      const { transfer_code } = await this.paystackService.initiateTransfer({
        source: 'balance',
        amount: vendorFeeKobo,
        recipient: bankAccount.paystackRecipientCode,
        reason: `Dispute resolution - payment for job: ${job.title}`,
        reference: transferReference,
      });

      await this.prisma.vendorJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.PAID,
          escrowStatus: EscrowStatus.RELEASED,
          confirmedAt: new Date(),
          transferCode: transfer_code,
        },
      });

      console.log(
        `Admin resolved dispute - Escrow RELEASED for job ${jobId}, transfer: ${transfer_code}`,
      );
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to resolve dispute (release): ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async resolveDisputeRefund(jobId: string): Promise<void> {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (job.escrowStatus !== EscrowStatus.DISPUTED) {
      throw new BadRequestException('Job is not in disputed state');
    }
    if (!job.escrowId)
      throw new BadRequestException('No escrow reference found');

    try {
      // Call Paystack refund API
      await this.paystackService.refundTransaction(job.escrowId);

      await this.prisma.vendorJob.update({
        where: { id: jobId },
        data: {
          escrowStatus: EscrowStatus.REFUNDED,
          refundedAt: new Date(),
        },
      });

      console.log(`Admin resolved dispute - Escrow REFUNDED for job ${jobId}`);
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to resolve dispute (refund): ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async saveBankAccount(
    vendorUserId: string,
    dto: {
      accountName: string;
      accountNumber: string;
      bankCode: string;
      bankName: string;
    },
  ): Promise<{
    id: string;
    vendorUserId: string;
    accountName: string;
    accountNumber: string;
    bankCode: string;
    bankName: string;
    paystackRecipientCode: string;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      // Create transfer recipient in Paystack
      const { recipient_code } =
        await this.paystackService.createTransferRecipient({
          type: 'nuban',
          name: dto.accountName,
          account_number: dto.accountNumber,
          bank_code: dto.bankCode,
          currency: 'NGN',
        });

      // Upsert bank account in DB
      const bankAccount = await this.prisma.vendorBankAccount.upsert({
        where: { vendorUserId },
        create: {
          vendorUserId,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          paystackRecipientCode: recipient_code,
        },
        update: {
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          paystackRecipientCode: recipient_code,
        },
      });

      return bankAccount;
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to save bank account: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async getBankAccount(vendorUserId: string): Promise<{
    id: string;
    vendorUserId: string;
    accountName: string;
    accountNumber: string;
    bankCode: string;
    bankName: string;
    paystackRecipientCode: string;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    return this.prisma.vendorBankAccount.findUnique({
      where: { vendorUserId },
    });
  }

  async listBanks(): Promise<{ id: number; name: string; code: string }[]> {
    return this.paystackService.listBanks();
  }

  async getJobByEscrowId(escrowId: string): Promise<{
    id: string;
    escrowStatus: EscrowStatus;
  } | null> {
    return this.prisma.vendorJob.findUnique({
      where: { escrowId },
      select: {
        id: true,
        escrowStatus: true,
      },
    });
  }

  // ── Subscription webhook handlers ─────────────────────────────────────────

  /** Fires when an agent first pays for a subscription (initial checkout) */
  async handleSubscriptionChargeSuccess(data: any): Promise<void> {
    const meta = data.metadata as Record<string, any>;
    const { agentProfileId, tier } = meta;
    if (!agentProfileId || !tier) {
      console.warn('handleSubscriptionChargeSuccess: missing metadata', meta);
      return;
    }

    try {
      const subCode = data.subscription_code || data.plan?.subscription_code;
      const customerCode = data.customer?.customer_code;
      const nextDate = data.paid_at
        ? new Date(
            new Date(data.paid_at).setMonth(
              new Date(data.paid_at).getMonth() + 1,
            ),
          )
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this._activateSubscription({
        agentProfileId,
        tier: tier as SubscriptionTier,
        amountKobo: data.amount,
        reference: data.reference,
        subscriptionCode: subCode ?? null,
        customerCode: customerCode ?? null,
        nextPaymentDate: nextDate,
      });
    } catch (err: any) {
      console.error('handleSubscriptionChargeSuccess error:', err.message);
    }
  }

  /** Fires on recurring monthly renewal */
  async handleSubscriptionRenewal(data: any): Promise<void> {
    const subCode =
      data.subscription?.subscription_code || data.subscription_code;
    if (!subCode) return;

    const profile = await this.prisma.agentProfile.findFirst({
      where: { paystackSubscriptionCode: subCode },
    });
    if (!profile) {
      console.warn(
        'handleSubscriptionRenewal: no profile for sub code',
        subCode,
      );
      return;
    }

    const nextDate = data.next_payment_date
      ? new Date(data.next_payment_date)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this._activateSubscription({
      agentProfileId: profile.id,
      tier: profile.subscriptionTier ?? SubscriptionTier.STANDARD,
      amountKobo: data.amount ?? 0,
      reference: data.reference ?? `renewal-${subCode}-${Date.now()}`,
      subscriptionCode: subCode,
      customerCode: data.customer?.customer_code ?? null,
      nextPaymentDate: nextDate,
    });
  }

  /** Fires when a renewal charge fails */
  async handleSubscriptionPaymentFailed(data: any): Promise<void> {
    const subCode =
      data.subscription?.subscription_code || data.subscription_code;
    if (!subCode) return;

    const profile = await this.prisma.agentProfile.findFirst({
      where: { paystackSubscriptionCode: subCode },
    });
    if (!profile) return;

    // Move to GRACE_PERIOD — listings stay live for 3 days (enforced by a cron job)
    await this.prisma.agentProfile.update({
      where: { id: profile.id },
      data: { subscriptionStatus: SubscriptionStatus.GRACE_PERIOD },
    });

    console.log(`Agent ${profile.id} entered GRACE_PERIOD after failed charge`);
  }

  /** Fires when a subscription is cancelled/disabled on Paystack side */
  async handleSubscriptionDisabled(data: any): Promise<void> {
    const subCode = data.subscription_code;
    if (!subCode) return;

    const profile = await this.prisma.agentProfile.findFirst({
      where: { paystackSubscriptionCode: subCode },
    });
    if (!profile) return;

    await this.prisma.agentProfile.update({
      where: { id: profile.id },
      data: { subscriptionStatus: SubscriptionStatus.CANCELLED },
    });
  }

  private async _activateSubscription(opts: {
    agentProfileId: string;
    tier: SubscriptionTier;
    amountKobo: number;
    reference: string;
    subscriptionCode: string | null;
    customerCode: string | null;
    nextPaymentDate: Date;
  }) {
    const existing = await this.prisma.subscriptionPayment.findUnique({
      where: { paystackRef: opts.reference },
    });
    if (existing) return; // idempotent

    await Promise.all([
      this.prisma.agentProfile.update({
        where: { id: opts.agentProfileId },
        data: {
          subscriptionTier: opts.tier,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          subscriptionRenewsAt: opts.nextPaymentDate,
          ...(opts.subscriptionCode && {
            paystackSubscriptionCode: opts.subscriptionCode,
          }),
          ...(opts.customerCode && {
            paystackCustomerCode: opts.customerCode,
          }),
        },
      }),
      this.prisma.subscriptionPayment.create({
        data: {
          agentProfileId: opts.agentProfileId,
          tier: opts.tier,
          amountKobo: opts.amountKobo,
          paystackRef: opts.reference,
          billingPeriodStart: new Date(),
          billingPeriodEnd: opts.nextPaymentDate,
          status: 'success',
        },
      }),
    ]);

    // Re-activate paused listings
    const profile = await this.prisma.agentProfile.findUnique({
      where: { id: opts.agentProfileId },
      select: { userId: true },
    });
    if (profile) {
      await this.prisma.listing.updateMany({
        where: { agentId: profile.userId, status: ListingStatus.PAUSED },
        data: { status: ListingStatus.ACTIVE },
      });
    }
  }
}
