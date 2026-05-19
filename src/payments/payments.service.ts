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

  /**
   * Fires right after Paystack creates a subscription on their side, following
   * the first successful charge. The payload carries the codes & tokens we
   * need to manage the sub later — most importantly email_token, which is
   * required (alongside subscription_code) to disable the subscription.
   * The handler is idempotent — re-receiving the same event is a no-op.
   */
  async handleSubscriptionCreate(data: any): Promise<void> {
    const subCode: string | undefined = data.subscription_code;
    const emailToken: string | null = data.email_token ?? null;
    const customerCode: string | undefined = data.customer?.customer_code;
    const customerEmail: string | undefined = data.customer?.email;

    if (!subCode || !customerEmail) {
      console.warn(
        'handleSubscriptionCreate: missing subscription_code or customer email',
        { subCode, customerEmail },
      );
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { email: customerEmail.toLowerCase() },
      select: { agentProfile: { select: { id: true } } },
    });
    if (!user?.agentProfile) {
      console.warn(
        'handleSubscriptionCreate: no agent profile for customer email',
        customerEmail,
      );
      return;
    }

    await this.prisma.agentProfile.update({
      where: { id: user.agentProfile.id },
      data: {
        paystackSubscriptionCode: subCode,
        ...(customerCode && { paystackCustomerCode: customerCode }),
        ...(emailToken && { paystackEmailToken: emailToken }),
      },
    });
  }

  /** Fires when an agent first pays for a subscription (initial checkout) */
  async handleSubscriptionChargeSuccess(data: any): Promise<void> {
    const meta = data.metadata as Record<string, any>;
    const { agentProfileId, tier } = meta;
    if (!agentProfileId || !tier) {
      console.warn('handleSubscriptionChargeSuccess: missing metadata', meta);
      return;
    }

    // Hoisted idempotency check — skips re-processing on webhook retries so
    // we don't re-attempt to disable an already-disabled previous sub.
    const alreadyProcessed = await this.prisma.subscriptionPayment.findUnique({
      where: { paystackRef: data.reference },
      select: { id: true },
    });
    if (alreadyProcessed) return;

    try {
      const subCode = data.subscription_code || data.plan?.subscription_code;
      const customerCode = data.customer?.customer_code;
      // Paystack issues an email_token on subscription creation that's required
      // (together with the subscription_code) to disable the sub later. The
      // charge.success payload either embeds the full subscription object or
      // just the code, so try both shapes — and fall back to /subscription/:code
      // if neither is present.
      let emailToken: string | null =
        data.subscription?.email_token ?? data.email_token ?? null;
      if (!emailToken && subCode) {
        try {
          const fetched = await this.paystackService.fetchSubscription(subCode);
          emailToken = fetched.email_token;
        } catch (e: any) {
          console.warn(
            'Could not fetch email_token for subscription',
            subCode,
            e?.message,
          );
        }
      }

      const nextDate = data.paid_at
        ? new Date(
            new Date(data.paid_at).setMonth(
              new Date(data.paid_at).getMonth() + 1,
            ),
          )
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Tier-switch cleanup: if the agent already has a Paystack subscription
      // and the new charge is for a different sub_code, that means they're
      // upgrading/downgrading. Disable the old sub so Paystack doesn't keep
      // auto-charging both plans next month.
      const existing = await this.prisma.agentProfile.findUnique({
        where: { id: agentProfileId },
        select: {
          paystackSubscriptionCode: true,
          paystackEmailToken: true,
        },
      });
      if (
        existing?.paystackSubscriptionCode &&
        existing.paystackSubscriptionCode !== subCode &&
        existing.paystackEmailToken
      ) {
        try {
          await this.paystackService.disableSubscription({
            code: existing.paystackSubscriptionCode,
            token: existing.paystackEmailToken,
          });
        } catch (e: any) {
          // Don't bail — activating the new sub matters more than cleaning up
          // the old. A subscription.disable webhook will arrive separately if
          // this succeeded server-side despite the error here.
          console.warn(
            `Failed to disable previous subscription ${existing.paystackSubscriptionCode} on tier change:`,
            e?.message,
          );
        }
      }

      await this._activateSubscription({
        agentProfileId,
        tier: tier as SubscriptionTier,
        amountKobo: data.amount,
        reference: data.reference,
        subscriptionCode: subCode ?? null,
        customerCode: customerCode ?? null,
        emailToken,
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
      select: { id: true, userId: true },
    });
    if (!profile) return;

    // Mark LAPSED and pause every active listing immediately. Renewing the
    // subscription will flip listings back to ACTIVE in _activateSubscription.
    await this.prisma.$transaction([
      this.prisma.agentProfile.update({
        where: { id: profile.id },
        data: { subscriptionStatus: SubscriptionStatus.LAPSED },
      }),
      this.prisma.listing.updateMany({
        where: { agentId: profile.userId, status: ListingStatus.ACTIVE },
        data: { status: ListingStatus.PAUSED },
      }),
    ]);

    console.log(`Agent ${profile.id} marked LAPSED after failed charge`);
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
    emailToken?: string | null;
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
          ...(opts.emailToken && {
            paystackEmailToken: opts.emailToken,
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
