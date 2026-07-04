import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  Header,
  HttpCode,
  Query,
  UseGuards,
  RawBody,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';
import { PaystackService } from './paystack.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paystackService: PaystackService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('initialize/:jobId')
  async initializePayment(
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() body: { returnUrl?: string } = {},
  ) {
    return this.paymentsService.initializeJobPayment(
      jobId,
      user.email,
      body?.returnUrl,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscription/verify/:reference')
  verifySubscription(
    @CurrentUser() user: CurrentUserData,
    @Param('reference') reference: string,
  ) {
    // Verify-on-return for the mobile agent subscription checkout — activates
    // the plan immediately instead of waiting on the charge.success webhook.
    return this.paymentsService.verifySubscriptionPayment(user.id, reference);
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify/:reference')
  async verifyPayment(@Param('reference') reference: string) {
    // Actively verify with Paystack and lock escrow if the charge succeeded,
    // so the app confirms on return without waiting on the webhook. Idempotent.
    await this.paymentsService.handleChargeSuccess(reference);
    const job = await this.paymentsService.getJobByEscrowId(reference);
    return { escrowStatus: job?.escrowStatus || 'NONE', jobId: job?.id };
  }

  /**
   * Public HTML bounce for mobile Paystack returns. Paystack redirects its
   * checkout success page here (an https URL it will actually follow), and this
   * page immediately forwards to the app's deep link so the in-app browser
   * closes and the app resumes to verify the charge. Only app schemes are
   * allowed as the target, so this can't be abused as an open redirect.
   */
  @SkipThrottle()
  @Get('mobile-return')
  @Header('Content-Type', 'text/html')
  mobileReturn(@Query('to') to?: string): string {
    const target = to ?? '';
    const allowed = /^(propertyloopmobile:\/\/|exp(\+[\w-]+)?:\/\/)/i.test(
      target,
    );
    const safeTarget = allowed ? target : '';
    // JSON.stringify safely embeds the URL as a JS string literal.
    const jsTarget = JSON.stringify(safeTarget);
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment complete</title>
<style>
  body { margin:0; font-family:-apple-system,Roboto,"Segoe UI",sans-serif; background:#fffbf4; color:#1a2120;
         display:flex; min-height:100vh; align-items:center; justify-content:center; text-align:center; }
  .card { padding:28px; }
  .tick { width:64px; height:64px; border-radius:50%; background:#e3efe7; color:#1f6f43;
          display:flex; align-items:center; justify-content:center; font-size:34px; margin:0 auto 16px; }
  h1 { font-size:19px; margin:0 0 6px; }
  p { font-size:14px; color:#4d524f; margin:0 0 20px; }
  a { display:inline-block; background:#1f6f43; color:#fff; text-decoration:none;
      padding:13px 22px; border-radius:100px; font-weight:700; font-size:14px; }
</style>
</head>
<body>
  <div class="card">
    <div class="tick">&#10003;</div>
    <h1>Payment received</h1>
    <p>Returning you to PropertyLoop&hellip;</p>
    <a id="back" href="${safeTarget}">Return to app</a>
  </div>
  <script>
    var target = ${jsTarget};
    if (target) { setTimeout(function(){ window.location.replace(target); }, 350); }
  </script>
</body>
</html>`;
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @RawBody() rawBody: Buffer,
    @Headers('x-paystack-signature') signature: string,
  ) {
    const isValid = this.paystackService.verifyWebhookSignature(
      rawBody,
      signature,
    );
    if (!isValid) {
      console.warn('Invalid webhook signature');
      return { received: true }; // Still return 200 to Paystack
    }

    const event = JSON.parse(rawBody.toString());

    if (event.event === 'charge.success') {
      const meta = event.data.metadata as Record<string, any> | null;
      if (meta?.type === 'agent_subscription') {
        await this.paymentsService.handleSubscriptionChargeSuccess(event.data);
      } else {
        await this.paymentsService.handleChargeSuccess(event.data.reference);
      }
    } else if (event.event === 'subscription.create') {
      // Canonical place Paystack hands us subscription_code, customer_code,
      // and email_token. Persist them so cancel/disable doesn't need a
      // fallback API round-trip.
      await this.paymentsService.handleSubscriptionCreate(event.data);
    } else if (
      event.event === 'invoices.create' ||
      event.event === 'subscription.charge.success'
    ) {
      // Paystack fires this on recurring subscription renewals
      await this.paymentsService.handleSubscriptionRenewal(event.data);
    } else if (
      event.event === 'invoice.payment_failed' ||
      event.event === 'subscription.charge.failure'
    ) {
      await this.paymentsService.handleSubscriptionPaymentFailed(event.data);
    } else if (
      event.event === 'subscription.disable' ||
      event.event === 'subscription.deactivate'
    ) {
      await this.paymentsService.handleSubscriptionDisabled(event.data);
    } else if (event.event === 'transfer.success') {
      await this.paymentsService.handleTransferSuccess(
        event.data.transfer_code,
      );
    } else if (event.event === 'transfer.failed') {
      console.error(`Transfer failed: ${event.data.transfer_code}`);
      await this.paymentsService.handleTransferFailed(event.data.transfer_code);
    }

    return { received: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('banks')
  async listBanks() {
    return this.paymentsService.listBanks();
  }

  // Confirm the real account holder name before the vendor saves/pays to it.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Get('resolve-account')
  async resolveAccount(
    @Query('account_number') accountNumber: string,
    @Query('bank_code') bankCode: string,
  ) {
    return this.paymentsService.resolveBankAccount(accountNumber, bankCode);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Post('bank-account')
  async saveBankAccount(
    @CurrentUser() user: CurrentUserData,
    @Body()
    dto: {
      accountName: string;
      accountNumber: string;
      bankCode: string;
      bankName: string;
    },
  ) {
    return this.paymentsService.saveBankAccount(user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Get('bank-account')
  async getBankAccount(@CurrentUser() user: CurrentUserData) {
    return this.paymentsService.getBankAccount(user.id);
  }

  // Vendor moves their available in-app balance to their bank.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Post('withdraw')
  @HttpCode(200)
  async withdraw(@CurrentUser() user: CurrentUserData) {
    return this.paymentsService.withdrawAvailable(user.id);
  }
}
