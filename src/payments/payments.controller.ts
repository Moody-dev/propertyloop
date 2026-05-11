import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  HttpCode,
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
  ) {
    return this.paymentsService.initializeJobPayment(jobId, user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify/:reference')
  async verifyPayment(@Param('reference') reference: string) {
    const job = await this.paymentsService.getJobByEscrowId(reference);
    return { escrowStatus: job?.escrowStatus || 'NONE', jobId: job?.id };
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
    }

    return { received: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('banks')
  async listBanks() {
    return this.paymentsService.listBanks();
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
}
