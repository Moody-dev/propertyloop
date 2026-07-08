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
    if (job.escrowStatus !== EscrowStatus.NONE) {
      throw new BadRequestException(
        'Payment has already been initiated for this job',
      );
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
      await this.prisma.vendorEarning.upsert({
        where: { jobId: job.id },
        create: {
          vendorUserId: job.vendorUserId,
          jobId: job.id,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.vendorFee,
          status: EarningStatus.PENDING,
        },
        update: {}, // already exists → leave its status as-is
      });

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
        where: { jobId },
        create: {
          vendorUserId: job.vendorUserId,
          jobId,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.vendorFee,
          status: EarningStatus.AVAILABLE,
        },
        update: { status: EarningStatus.AVAILABLE },
      }),
    ]);

    console.log(
      `Escrow RELEASED for job ${jobId} → vendor balance (AVAILABLE) ${job.vendorFee}`,
    );
  }

  // ─── Vendor wallet withdrawal ─────────────────────────────────────────────

  /**
   * Vendor moves their AVAILABLE balance to their bank. Initiates one Paystack
   * transfer per released earning (so each reconciles via the existing
   * transfer webhook) and flips those earnings to PROCESSING. The amount lands
   * as PAID once Paystack fires transfer.success.
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

    let withdrawn = 0;
    let failures = 0;
    let lastError: string | undefined;
    for (const earning of available) {
      try {
        const transferReference = `PLWD-${earning.jobId}-${Date.now()}`;
        const { transfer_code, status } =
          await this.paystackService.initiateTransfer({
            source: 'balance',
            amount: earning.amount * 100,
            recipient: bankAccount.paystackRecipientCode,
            reason: `Payout for job: ${earning.jobTitle}`,
            reference: transferReference,
          });

        // Live accounts have "OTP for Transfers" on by default: Paystack returns
        // status 'otp' and freezes the transfer until it's finalized with a code
        // sent to the merchant — which no automated payout can supply. Treat it
        // as a failure so the money stays AVAILABLE and the vendor isn't shown a
        // "processing" transfer that will never land. Fix: disable OTP for
        // transfers in the Paystack dashboard (Settings → Preferences).
        if (status === 'otp') {
          failures += 1;
          lastError =
            'Payouts are blocked: turn off "OTP for Transfers" in your Paystack dashboard (Settings → Preferences) so payouts can send automatically.';
          console.error(
            `Withdrawal blocked by transfer OTP for earning ${earning.id}. Disable OTP for transfers in the Paystack dashboard.`,
          );
          continue;
        }

        await this.prisma.$transaction([
          this.prisma.vendorEarning.update({
            where: { id: earning.id },
            data: { status: EarningStatus.PROCESSING },
          }),
          // Correlate the eventual transfer.success webhook back to this job.
          this.prisma.vendorJob.update({
            where: { id: earning.jobId },
            data: { transferCode: transfer_code },
          }),
        ]);
        withdrawn += earning.amount;
      } catch (error: any) {
        failures += 1;
        lastError = error.response?.data?.message || error.message;
        console.error(
          `Withdrawal transfer failed for earning ${earning.id}:`,
          lastError,
        );
      }
    }

    if (withdrawn === 0) {
      // Always log the raw Paystack reason for the operator — it's almost always
      // a platform-account/float issue (settlement swept the balance, transfers
      // not enabled, invalid recipient) that the vendor can't act on.
      console.error(
        `Withdrawal blocked for vendor ${vendorUserId}: ${lastError ?? 'unknown'}`,
      );
      // "Balance not enough" means OUR Paystack float is empty (collected escrow
      // has settled to the company bank, not the transferable balance) — not the
      // vendor's fault. Show them something reassuring instead of an alarming
      // "your balance is not enough", which reads like they have no money.
      const isPlatformFloatEmpty =
        typeof lastError === 'string' &&
        /balance is not enough|insufficient|not enough/i.test(lastError);
      throw new BadRequestException(
        isPlatformFloatEmpty
          ? "Your payout is being processed and your money is safe — payouts settle within 24 hours. Please try again shortly."
          : lastError
            ? `Withdrawal couldn't start: ${lastError}`
            : 'Could not start your withdrawal. Please try again shortly.',
      );
    }

    return {
      success: true,
      amount: withdrawn,
      count: available.length - failures,
      bankName: bankAccount.bankName,
      accountNumber: bankAccount.accountNumber,
    };
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
        where: { jobId },
        create: {
          vendorUserId: job.vendorUserId,
          jobId,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.vendorFee,
          status: EarningStatus.AVAILABLE,
        },
        update: { status: EarningStatus.AVAILABLE },
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

    try {
      // Call Paystack refund API
      await this.paystackService.refundTransaction(job.escrowId);

      await this.prisma.$transaction([
        this.prisma.vendorJob.update({
          where: { id: jobId },
          data: {
            escrowStatus: EscrowStatus.REFUNDED,
            refundedAt: new Date(),
          },
        }),
        // Money went back to the buyer — drop the vendor's pending earning so
        // it stops counting toward their "in escrow" balance.
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
