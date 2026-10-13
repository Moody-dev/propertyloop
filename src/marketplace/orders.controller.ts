import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MarketplaceOrdersService } from './orders.service';
import { MarketplaceDisputesService } from './disputes.service';
import { CreateMarketplaceOrderDto } from './dto/create-order.dto';
import { RaiseDisputeDto } from './dto/dispute.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@Controller('marketplace/orders')
export class MarketplaceOrdersController {
  constructor(
    private readonly service: MarketplaceOrdersService,
    private readonly disputes: MarketplaceDisputesService,
  ) {}

  // Guests and signed-in buyers can both check out. When signed in, the order
  // is linked to the account so it shows up under "my orders".
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(
    @Body() dto: CreateMarketplaceOrderDto,
    @Req() req: { user?: CurrentUserData },
  ) {
    return this.service.createAndInitialize(dto, req.user);
  }

  // Public verify-on-return. The reference is unguessable, so a guest can
  // confirm their own order; a signed-in buyer can't read someone else's.
  @UseGuards(OptionalJwtAuthGuard)
  @Get('verify/:reference')
  verify(
    @Param('reference') reference: string,
    @Req() req: { user?: CurrentUserData },
  ) {
    return this.service.verifyAndGet(reference, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.service.listForBuyer(
      user.id,
      Number(page) || 1,
      Number(limit) || 24,
    );
  }

  // A buyer opens a dispute on their paid order. Optional auth so a guest can
  // dispute an order they hold the number for; a signed-in buyer must own it.
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':orderNumber/dispute')
  raiseDispute(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: RaiseDisputeDto,
    @Req() req: { user?: CurrentUserData },
  ) {
    return this.disputes.raise(orderNumber, dto, req.user);
  }
}
