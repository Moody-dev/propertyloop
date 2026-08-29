import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-types';
import {
  EarningKind,
  EarningStatus,
  EscrowStatus,
  JobStatus,
  SubscriptionTier,
  SubscriptionStatus,
  ListingStatus,
} from '../../generated/prisma/client';
import { FREE_LISTING_CAP } from '../listings/listing-limits';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private paystackService: PaystackService,
    private configService: ConfigService,
    private notifications: NotificationsService,
  ) {}

  async initializeJobPayment(
    jobId: string,
    buyerEmail: string,
    returnUrl?: string,
  ): Promise<{ paymentUrl: string; reference: string }> {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new NotFoundException('Job not found');
    // Escrow can only ever be funded while the vendor is still working. Once the
    // job is COMPLETED (or beyond), a second checkout must never be possible —
    // this is the core guard against charging a customer twice for one job.
    if (
      job.status !== JobStatus.ACCEPTED &&
      job.status !== JobStatus.IN_PROGRESS
    ) {
      throw new BadRequestException(
        'Escrow can only be funded before the job is completed. Do not attempt payment again; contact support if a prior payment is still verifying.',
      );
    }
    if (job.escrowStatus !== EscrowStatus.NONE) {
      throw new BadRequestException(
        'Payment has already been initiated for this job',
      );
    }

    // A prior checkout reference already exists but escrow is still unlocked.
    // Don't blindly open a new checkout (would risk a double charge) and don't
    // blindly block (would strand a buyer who abandoned the first checkout).
    // Ask Paystack what actually happened to that reference and decide:
    //   • charged successfully  → heal it (lock escrow) and refuse a re-charge
    //   • abandoned / failed     → let the buyer retry with a fresh reference
    if (job.escrowId) {
      let priorSucceeded = false;
      try {
        const txn = await this.paystackService.verifyTransaction(job.escrowId);
        priorSucceeded = txn.status === 'success';
      } catch {
        // Reference unknown/unverifiable at Paystack → treat as not paid so the
        // buyer isn't stranded; a genuine charge is still protected by the
        // amount + idempotency checks in handleChargeSuccess.
        priorSucceeded = false;
      }
      if (priorSucceeded) {
        // Reconcile the real charge, then stop — never a second checkout.
        await this.handleChargeSuccess(job.escrowId);
        throw new BadRequestException(
          'This job is already paid — we are securing it in escrow now. Do not pay again; pull to refresh in a moment.',
        );
      }
      // Otherwise fall through and mint a new reference below, overwriting the
      // abandoned one so refunds/webhooks track the reference actually charged.
    }

    const amountKobo = job.escrowAmount * 100;
    const reference = `PLJOB-${jobId}-${Date.now()}`;
    // When the mobile app initiates payment it passes its own deep-link return
    // URL so Paystack sends the user straight back into the app. Web/no-URL
    // callers fall back to the web payment-callback page.
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    // Paystack won't redirect to a custom app scheme, so wrap the mobile deep
    // link in our https bounce page; web/no-URL callers use the site callback.
    const callbackUrl =
      returnUrl && returnUrl.trim()
        ? this.paystackService.buildMobileReturnUrl(returnUrl)
        : `${frontendUrl}/payment-callback?jobId=${jobId}`;

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
    let job = await this.prisma.vendorJob.findUnique({
      where: { escrowId: reference },
    });

    if (!job) {
      // Recovery: the buyer may have re-initiated checkout (which overwrote
      // escrowId with a newer reference) and then paid the OLDER checkout tab.
      // The transaction metadata carries the jobId — recover through it and
      // adopt the reference that was actually charged, so refunds target the
      // right transaction.
      try {
        const txn = await this.paystackService.verifyTransactionRaw(reference);
        const metaJobId = txn?.metadata?.jobId;
        if (
          txn?.status === 'success' &&
          metaJobId &&
          txn?.metadata?.type === 'vendor_job'
        ) {
          const candidate = await this.prisma.vendorJob.findUnique({
            where: { id: metaJobId },
          });
          if (candidate && candidate.escrowStatus === EscrowStatus.NONE) {
            job = await this.prisma.vendorJob.update({
              where: { id: candidate.id },
              data: { escrowId: reference },
            });
          }
        }
      } catch {
        /* fall through to the warn below */
      }
    }

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

      // Surface the money on the vendor's dashboard right away as "in escrow"
      // (PENDING) — it isn't theirs to withdraw yet, but they can see it coming.
      // Both halves are created up front so the vendor can see the deposit that
      // unlocks when they start, alongside the balance held until confirmation.
      await this.prisma.vendorEarning.upsert({
        where: { jobId_kind: { jobId: job.id, kind: EarningKind.FINAL } },
        create: {
          vendorUserId: job.vendorUserId,
          jobId: job.id,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.finalAmount || job.vendorFee,
          kind: EarningKind.FINAL,
          status: EarningStatus.PENDING,
        },
        update: {}, // already exists → leave its status as-is
      });

      // Jobs predating the split payout have no deposit half; skip it entirely
      // rather than parking a ₦0 row on their earnings screen.
      if (job.depositAmount > 0) {
        await this.prisma.vendorEarning.upsert({
          where: { jobId_kind: { jobId: job.id, kind: EarningKind.DEPOSIT } },
          create: {
            vendorUserId: job.vendorUserId,
            jobId: job.id,
            jobTitle: job.title,
            clientName: job.clientName,
            amount: job.depositAmount,
            kind: EarningKind.DEPOSIT,
            status: EarningStatus.PENDING,
          },
          update: {},
        });
      }

      // Tell the vendor their money is secured so they can start — previously
      // they only found out by chance when opening the job tracker.
      void this.notifications.notify({
        userId: job.vendorUserId,
        type: NotificationType.JOB_ESCROW_FUNDED,
        title: 'Payment secured — you can start',
        body: `${job.clientName} funded escrow for "${job.title}". Start the job whenever you're ready.`,
        data: { jobId: job.id },
      });

      console.log(`Escrow LOCKED for job ${job.id} via reference ${reference}`);
    } catch (error: any) {
      console.error(
        `Error handling charge.success webhook for ${reference}:`,
        error.message,
      );
    }
  }

  /**
   * charge.success for a brand ad (metadata.type === 'brand_ad'). Lives here
   * rather than AdsService so the webhook doesn't need a circular module
   * import (AdsModule → PaymentsModule for Paystack). Idempotent.
   */
  async handleAdChargeSuccess(reference: string): Promise<void> {
    const ad = await this.prisma.brandAd.findUnique({
      where: { paymentRef: reference },
    });
    if (!ad || ad.status !== 'DRAFT') return;

    try {
      const txn = await this.paystackService.verifyTransaction(reference);
      if (txn.status !== 'success') return;
      if (txn.amount !== ad.amountNaira * 100) {
        console.warn(
          `Ad payment amount mismatch for ${reference}: expected ${ad.amountNaira * 100}, got ${txn.amount}`,
        );
        return;
      }
      await this.prisma.brandAd.update({
        where: { id: ad.id },
        data: { status: 'PENDING_REVIEW', paidAt: new Date() },
      });
      console.log(`Brand ad ${ad.id} paid via ${reference} → PENDING_REVIEW`);
    } catch (error: any) {
      console.error(
        `Error handling brand-ad charge.success for ${reference}:`,
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

    // Wallet model: releasing escrow doesn't push money to the bank. It moves
    // the vendor fee into the vendor's in-app balance (AVAILABLE), which they
    // later withdraw themselves. No bank account is required at this step.
    //
    // Confirmation settles the final half. Any deposit still sitting PENDING is
    // swept up too — a job can reach COMPLETED without ever passing through
    // start() (see complete(), which accepts ACCEPTED jobs), and that deposit
    // is owed either way once the buyer confirms.
    await this.prisma.$transaction([
      this.prisma.vendorJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.PAID,
          escrowStatus: EscrowStatus.RELEASED,
          confirmedAt: new Date(),
        },
      }),
      this.prisma.vendorEarning.upsert({
        where: { jobId_kind: { jobId, kind: EarningKind.FINAL } },
        create: {
          vendorUserId: job.vendorUserId,
          jobId,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.finalAmount || job.vendorFee,
          kind: EarningKind.FINAL,
          status: EarningStatus.AVAILABLE,
        },
        update: { status: EarningStatus.AVAILABLE },
      }),
      this.prisma.vendorEarning.updateMany({
        where: { jobId, kind: EarningKind.DEPOSIT, status: EarningStatus.PENDING },
        data: { status: EarningStatus.AVAILABLE },
      }),
    ]);

    console.log(
      `Escrow RELEASED for job ${jobId} → vendor balance (AVAILABLE) ${job.finalAmount || job.vendorFee}`,
    );
  }

  /**
   * Releases the vendor's deposit half once they actually start work. Called
   * from VendorJobsService.start(), which has already checked that escrow is
   * LOCKED, so this only moves the deposit into their withdrawable balance and
   * never touches the final half.
   *
   * Idempotent and silent on jobs with no deposit (created before the split
   * payout), so start() can call it unconditionally.
   */
  async releaseDeposit(jobId: string): Promise<void> {
    const job = await this.prisma.vendorJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.depositAmount <= 0 || job.depositReleasedAt) return;
    if (job.escrowStatus !== EscrowStatus.LOCKED) {
      throw new BadRequestException(
        'Escrow must be funded before the deposit can be released',
      );
    }

    await this.prisma.$transaction([
      this.prisma.vendorJob.update({
        where: { id: jobId },
        data: { depositReleasedAt: new Date() },
      }),
      this.prisma.vendorEarning.upsert({
        where: { jobId_kind: { jobId, kind: EarningKind.DEPOSIT } },
        create: {
          vendorUserId: job.vendorUserId,
          jobId,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.depositAmount,
          kind: EarningKind.DEPOSIT,
          status: EarningStatus.AVAILABLE,
        },
        update: { status: EarningStatus.AVAILABLE },
      }),
    ]);

    void this.notifications.notify({
      userId: job.vendorUserId,
      type: NotificationType.JOB_DEPOSIT_RELEASED,
      title: 'Deposit released',
      body: `Your ₦${job.depositAmount.toLocaleString('en-NG')} deposit for "${job.title}" is in your balance. The rest follows when ${job.clientName} confirms the work.`,
      data: { jobId },
    });

    console.log(
      `Deposit RELEASED for job ${jobId} → vendor balance (AVAILABLE) ${job.depositAmount}`,
    );
  }

  // ─── Vendor wallet withdrawal (manual payouts) ────────────────────────────

  /**
   * Vendor requests their AVAILABLE balance. Paystack transfers aren't enabled
   * on our account, so no money moves here: the earnings flip to PROCESSING
   * and a PENDING WithdrawalRequest lands in the admin console, where an admin
   * makes the bank transfer manually and then marks it paid (or rejects it,
   * returning the earnings to AVAILABLE).
   */
  async withdrawAvailable(vendorUserId: string) {
    const bankAccount = await this.prisma.vendorBankAccount.findUnique({
      where: { vendorUserId },
    });
    if (!bankAccount) {
      throw new BadRequestException(
        'Add a payout bank account before withdrawing.',
      );
    }

    const available = await this.prisma.vendorEarning.findMany({
      where: { vendorUserId, status: EarningStatus.AVAILABLE },
    });
    if (available.length === 0) {
      throw new BadRequestException('You have no funds available to withdraw.');
    }

    const total = available.reduce((sum, e) => sum + e.amount, 0);

    // One request bundles everything currently withdrawable. Snapshot the bank
    // details so the admin pays the account that was on file at request time.
    const request = await this.prisma.$transaction(async (tx) => {
      const req = await tx.withdrawalRequest.create({
        data: {
          vendorUserId,
          amountNaira: total,
          bankName: bankAccount.bankName,
          accountNumber: bankAccount.accountNumber,
          accountName: bankAccount.accountName,
        },
      });
      await tx.vendorEarning.updateMany({
        where: { id: { in: available.map((e) => e.id) } },
        data: {
          status: EarningStatus.PROCESSING,
          withdrawalRequestId: req.id,
        },
      });
      return req;
    });

    console.log(
      `Withdrawal request ${request.id} created: vendor ${vendorUserId}, ${total} NGN → ${bankAccount.bankName} ${bankAccount.accountNumber}`,
    );

    return {
      success: true,
      amount: total,
      count: available.length,
      bankName: bankAccount.bankName,
      accountNumber: bankAccount.accountNumber,
      // Manual processing — the app copy should say "our team", not "instant".
      manual: true,
    };
  }

  // ─── Admin: manual payout queue ───────────────────────────────────────────

  async listWithdrawals(opts: { page: number; limit: number; status?: string }) {
    const { page, limit } = opts;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts.status && ['PENDING', 'PAID', 'REJECTED'].includes(opts.status)) {
      where.status = opts.status;
    }

    const [items, total, pendingAgg] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
        include: {
          vendor: { select: { id: true, name: true, email: true, phone: true } },
          earnings: { select: { id: true, jobTitle: true, clientName: true, amount: true } },
        },
      }),
      this.prisma.withdrawalRequest.count({ where }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: 'PENDING' },
        _count: true,
        _sum: { amountNaira: true },
      }),
    ]);

    return {
      items,
      total,
      pendingTotal: pendingAgg._count,
      pendingAmount: pendingAgg._sum.amountNaira ?? 0,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Admin settles a withdrawal after (or instead of) the manual bank transfer.
   * - paid: earnings → PAID with paidAt; vendor notified the money was sent.
   * - reject: earnings → back to AVAILABLE (unlinked); vendor notified why.
   */
  async decideWithdrawal(
    withdrawalId: string,
    action: 'paid' | 'reject',
    adminNote?: string,
  ) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      include: { earnings: { select: { id: true } } },
    });
    if (!request) throw new NotFoundException('Withdrawal request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This withdrawal has already been settled');
    }

    const earningIds = request.earnings.map((e) => e.id);
    const now = new Date();
    const naira = `₦${request.amountNaira.toLocaleString('en-NG')}`;
    const last4 = request.accountNumber.slice(-4);

    if (action === 'paid') {
      await this.prisma.$transaction([
        this.prisma.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            status: 'PAID',
            processedAt: now,
            ...(adminNote?.trim() && { adminNote: adminNote.trim() }),
          },
        }),
        this.prisma.vendorEarning.updateMany({
          where: { id: { in: earningIds } },
          data: { status: EarningStatus.PAID, paidAt: now },
        }),
      ]);

      void this.notifications.notify({
        userId: request.vendorUserId,
        type: NotificationType.WITHDRAWAL_PAID,
        title: 'Withdrawal paid',
        body: `${naira} has been sent to your ${request.bankName} account ••${last4}.`,
        data: { withdrawalId },
      });
    } else {
      await this.prisma.$transaction([
        this.prisma.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            status: 'REJECTED',
            processedAt: now,
            adminNote: adminNote?.trim() || null,
          },
        }),
        // The money never left — put it back in the withdrawable balance.
        this.prisma.vendorEarning.updateMany({
          where: { id: { in: earningIds } },
          data: { status: EarningStatus.AVAILABLE, withdrawalRequestId: null },
        }),
      ]);

      void this.notifications.notify({
        userId: request.vendorUserId,
        type: NotificationType.WITHDRAWAL_REJECTED,
        title: 'Withdrawal returned to balance',
        body: adminNote?.trim()
          ? `${naira} is back in your balance: ${adminNote.trim()}`
          : `${naira} is back in your withdrawable balance. Contact support if you weren't expecting this.`,
        data: { withdrawalId },
      });
    }

    return this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      include: {
        vendor: { select: { id: true, name: true, email: true, phone: true } },
        earnings: { select: { id: true, jobTitle: true, clientName: true, amount: true } },
      },
    });
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
      // Mark the job's earnings as PAID. Both halves settle together here: an
      // automated transfer covers whatever the vendor was owed on this job.
      // (Transfers aren't enabled on our account, so this path is dormant —
      // manual payouts settle through decideWithdrawal instead.)
      const settled = await this.prisma.vendorEarning.updateMany({
        where: { jobId: job.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      if (settled.count === 0) {
        // No earning was ever recorded for this job — create the final half so
        // the transfer isn't silently lost from the vendor's history.
        await this.prisma.vendorEarning.create({
          data: {
            vendorUserId: job.vendorUserId,
            jobId: job.id,
            jobTitle: job.title,
            clientName: job.clientName,
            amount: job.vendorFee,
            kind: EarningKind.FINAL,
            status: 'PAID',
            paidAt: new Date(),
          },
        });
      }

      // Close the loop for the vendor — the money actually reached their bank.
      void this.notifications.notify({
        userId: job.vendorUserId,
        type: NotificationType.JOB_CONFIRMED,
        title: 'Withdrawal sent to your bank',
        body: `₦${Math.round(job.vendorFee).toLocaleString('en-NG')} for "${job.title}" has been paid out to your bank account.`,
        data: { jobId: job.id },
      });

      console.log(`Vendor earning recorded for job ${job.id}`);
    } catch (error: any) {
      console.error(
        `Error handling transfer.success webhook for ${transferCode}:`,
        error.message,
      );
    }
  }

  /**
   * A withdrawal transfer bounced — put the money back as AVAILABLE so the
   * vendor can retry, rather than leaving it stuck in PROCESSING.
   */
  async handleTransferFailed(transferCode: string): Promise<void> {
    const job = await this.prisma.vendorJob.findFirst({
      where: { transferCode },
    });
    if (!job) return;
    await this.prisma.vendorEarning.updateMany({
      where: { jobId: job.id, status: EarningStatus.PROCESSING },
      data: { status: EarningStatus.AVAILABLE },
    });
    // Tell the vendor rather than silently re-crediting their balance.
    void this.notifications.notify({
      userId: job.vendorUserId,
      type: NotificationType.JOB_CONFIRMED,
      title: "Withdrawal didn't go through",
      body: `The bank transfer for "${job.title}" failed. The money is back in your balance — check your payout account and try again.`,
      data: { jobId: job.id },
    });
    console.warn(`Transfer failed for job ${job.id} → earning back to AVAILABLE`);
  }

  async resolveDisputeRelease(jobId: string): Promise<void> {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (job.escrowStatus !== EscrowStatus.DISPUTED) {
      throw new BadRequestException('Job is not in disputed state');
    }

    // Resolved in the vendor's favour: same as a normal release — credit the
    // vendor's in-app balance (AVAILABLE). They withdraw it themselves, so no
    // bank account is required here and no transfer is fired.
    await this.prisma.$transaction([
      this.prisma.vendorJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.PAID,
          escrowStatus: EscrowStatus.RELEASED,
          confirmedAt: new Date(),
        },
      }),
      this.prisma.vendorEarning.upsert({
        where: { jobId_kind: { jobId, kind: EarningKind.FINAL } },
        create: {
          vendorUserId: job.vendorUserId,
          jobId,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.finalAmount || job.vendorFee,
          kind: EarningKind.FINAL,
          status: EarningStatus.AVAILABLE,
        },
        update: { status: EarningStatus.AVAILABLE },
      }),
      // Resolved for the vendor, so any deposit still held is theirs too.
      this.prisma.vendorEarning.updateMany({
        where: { jobId, kind: EarningKind.DEPOSIT, status: EarningStatus.PENDING },
        data: { status: EarningStatus.AVAILABLE },
      }),
    ]);

    console.log(
      `Admin resolved dispute - Escrow RELEASED for job ${jobId} → vendor balance`,
    );
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

    // Only the money PropertyLoop still holds can go back. Once the vendor has
    // started and taken their deposit, that half has left the platform, so a
    // full refund would pay out money we no longer have. Refund the remainder
    // — the buyer is made whole on everything except work already begun.
    const releasedToVendor = job.depositReleasedAt ? job.depositAmount : 0;
    const refundableNaira = Math.max(0, job.escrowAmount - releasedToVendor);

    if (refundableNaira === 0) {
      throw new BadRequestException(
        'Nothing left to refund — the full amount has already been released to the vendor.',
      );
    }

    try {
      // Partial refund when a deposit is already out, full refund otherwise.
      await this.paystackService.refundTransaction(
        job.escrowId,
        refundableNaira * 100,
      );

      await this.prisma.$transaction([
        this.prisma.vendorJob.update({
          where: { id: jobId },
          data: {
            escrowStatus: EscrowStatus.REFUNDED,
            refundedAt: new Date(),
          },
        }),
        // Money went back to the buyer — drop the vendor's pending earnings so
        // they stop counting toward their "in escrow" balance. An already
        // released deposit is deliberately left alone: it was excluded from the
        // refund above, so the vendor keeps it and the books still balance.
        this.prisma.vendorEarning.deleteMany({
          where: { jobId, status: EarningStatus.PENDING },
        }),
        // The job was counted toward the vendor's completed total when it was
        // marked complete; a refund reverses that (no longer a delivered job).
        this.prisma.vendorProfile.update({
          where: { userId: job.vendorUserId },
          data: { jobsCount: { decrement: 1 } },
        }),
      ]);

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
    paystackRecipientCode: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    // Best-effort: payouts are settled manually by an admin, so a Paystack
    // recipient code is only useful for a future automated flow. Never block
    // saving the payout account (which the admin needs to transfer to) just
    // because recipient creation is unavailable on our Paystack plan.
    let recipientCode: string | null = null;
    try {
      const { recipient_code } =
        await this.paystackService.createTransferRecipient({
          type: 'nuban',
          name: dto.accountName,
          account_number: dto.accountNumber,
          bank_code: dto.bankCode,
          currency: 'NGN',
        });
      recipientCode = recipient_code;
    } catch (error: any) {
      console.warn(
        `Paystack recipient creation failed for vendor ${vendorUserId} (continuing — payouts are manual):`,
        error.response?.data?.message || error.message,
      );
    }

    try {
      const bankAccount = await this.prisma.vendorBankAccount.upsert({
        where: { vendorUserId },
        create: {
          vendorUserId,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          paystackRecipientCode: recipientCode,
        },
        update: {
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          ...(recipientCode && { paystackRecipientCode: recipientCode }),
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
    paystackRecipientCode: string | null;
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

  /** Resolve the account holder name for a number + bank (pre-save check). */
  async resolveBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ accountNumber: string; accountName: string }> {
    if (!/^[0-9]{10}$/.test(accountNumber ?? '')) {
      throw new BadRequestException('Enter a valid 10-digit account number.');
    }
    if (!bankCode) {
      throw new BadRequestException('Pick a bank first.');
    }
    try {
      const { account_number, account_name } =
        await this.paystackService.resolveAccount(accountNumber, bankCode);
      return { accountNumber: account_number, accountName: account_name };
    } catch (error: any) {
      throw new BadRequestException(
        error.response?.data?.message ||
          'Could not verify this account. Check the number and bank.',
      );
    }
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

  /**
   * Verify-on-return for the mobile app: actively confirm a subscription
   * charge with Paystack and activate the plan without waiting on the
   * webhook. Idempotent — handleSubscriptionChargeSuccess skips references
   * that were already processed. Returns the caller's fresh subscription
   * state so the app can show "plan active" immediately.
   */
  async verifySubscriptionPayment(userId: string, reference: string) {
    const data = await this.paystackService.verifyTransactionRaw(reference);
    const meta = (data?.metadata ?? {}) as Record<string, any>;
    if (meta?.type !== 'agent_subscription' || meta?.userId !== userId) {
      throw new BadRequestException(
        'Reference is not a subscription payment for this account',
      );
    }

    if (data.status === 'success') {
      await this.handleSubscriptionChargeSuccess(data);
    }

    const profile = await this.prisma.agentProfile.findUnique({
      where: { userId },
      select: {
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionRenewsAt: true,
      },
    });
    return {
      paymentStatus: data.status as 'success' | 'failed' | 'pending',
      tier: profile?.subscriptionTier ?? null,
      status: profile?.subscriptionStatus ?? null,
      renewsAt: profile?.subscriptionRenewsAt ?? null,
    };
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

    // Mark LAPSED but KEEP the paid tier — Paystack may retry the charge, and a
    // successful retry restores the paid tier in handleSubscriptionRenewal
    // (which reads tier off the profile). We keep the FREE allowance of active
    // listings visible and pause the rest; if the retries are exhausted,
    // Paystack fires subscription.disable → handleSubscriptionDisabled, which
    // finalises the downgrade to FREE.
    await this.prisma.agentProfile.update({
      where: { id: profile.id },
      data: { subscriptionStatus: SubscriptionStatus.LAPSED },
    });
    await this._keepFreeAllowanceActive(profile.userId);

    console.log(
      `Agent ${profile.id} LAPSED after failed charge — kept ${FREE_LISTING_CAP} active`,
    );
  }

  /**
   * Drop an agent to the FREE allowance of active listings: keep the most
   * recent FREE_LISTING_CAP active listings, pause the rest. Used when a
   * subscription lapses or is cancelled.
   */
  private async _keepFreeAllowanceActive(userId: string): Promise<void> {
    const keep = await this.prisma.listing.findMany({
      where: { agentId: userId, status: ListingStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      take: FREE_LISTING_CAP,
      select: { id: true },
    });
    const keepIds = keep.map((l) => l.id);
    await this.prisma.listing.updateMany({
      where: {
        agentId: userId,
        status: ListingStatus.ACTIVE,
        id: { notIn: keepIds },
      },
      data: { status: ListingStatus.PAUSED },
    });
  }

  /** Fires when a subscription is cancelled/disabled on Paystack side */
  async handleSubscriptionDisabled(data: any): Promise<void> {
    const subCode = data.subscription_code;
    if (!subCode) return;

    const profile = await this.prisma.agentProfile.findFirst({
      where: { paystackSubscriptionCode: subCode },
    });
    if (!profile) return;

    // Final downgrade: the subscription is gone for good, so move the agent to
    // the FREE plan (ACTIVE so their free 3 listings stay usable), drop the
    // Paystack subscription handle, and pause anything beyond the free cap.
    await this.prisma.agentProfile.update({
      where: { id: profile.id },
      data: {
        subscriptionTier: SubscriptionTier.FREE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionRenewsAt: null,
        paystackSubscriptionCode: null,
        paystackEmailToken: null,
      },
    });
    await this._keepFreeAllowanceActive(profile.userId);
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
