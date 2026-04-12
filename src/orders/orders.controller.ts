import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Post()
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateOrderDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.service.listForBuyer(user.id, Number(page) || 1, Number(limit) || 24);
  }

  @Get('number/:orderNumber')
  getByNumber(
    @CurrentUser() user: CurrentUserData,
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.service.getByOrderNumber(orderNumber, user.id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.service.getById(id, user.id);
  }
}
