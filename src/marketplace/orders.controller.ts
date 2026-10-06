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
import { CreateMarketplaceOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@Controller('marketplace/orders')
export class MarketplaceOrdersController {
  constructor(private readonly service: MarketplaceOrdersService) {}

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
}
