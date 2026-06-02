import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';
import { ListOffersDto } from './dto/list-offers.dto';
import { UpdateStepDto } from './dto/update-step.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  // ─── Buyer: submit an offer ──────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateOfferDto) {
    return this.offersService.create(user.id, dto);
  }

  // ─── Lists ───────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  listMine(@CurrentUser() user: CurrentUserData, @Query() query: ListOffersDto) {
    return this.offersService.listForBuyer(user.id, query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get('received')
  listReceived(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListOffersDto,
  ) {
    return this.offersService.listForAgent(user.id, query);
  }

  // ─── Purchase progress (must precede :id routes) ─────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('purchases')
  listPurchases(@CurrentUser() user: CurrentUserData) {
    return this.offersService.listPurchases(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('purchases/:id')
  getPurchase(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.offersService.getPurchase(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('purchases/:id/steps/:stepId')
  updateStep(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateStepDto,
  ) {
    return this.offersService.updateStep(user.id, id, stepId, dto);
  }

  // ─── Single offer + actions ──────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getOne(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.offersService.getById(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/counter')
  counter(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CounterOfferDto,
  ) {
    return this.offersService.counter(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/accept')
  accept(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.offersService.accept(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/decline')
  decline(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.offersService.decline(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.offersService.withdraw(user.id, id);
  }
}
