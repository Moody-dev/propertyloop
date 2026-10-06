import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/client';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { MarketplaceStoresService } from './stores.service';
import { MarketplaceProductsService } from './products.service';
import { MarketplaceOrdersService } from './orders.service';
import { UpsertStoreDto } from './dto/upsert-store.dto';
import { CreateProductDto, UpdateProductDto } from './dto/upsert-product.dto';

/**
 * Everything a vendor does to run their own store. All routes require a signed-in
 * VENDOR; store ownership is derived from the token, never from the request body,
 * so a vendor can only ever touch their own storefront and products.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.VENDOR)
@Controller('marketplace/vendor')
export class MarketplaceVendorController {
  constructor(
    private readonly stores: MarketplaceStoresService,
    private readonly products: MarketplaceProductsService,
    private readonly orders: MarketplaceOrdersService,
  ) {}

  // ─── Store ──────────────────────────────────────────────────────────────
  @Get('store')
  getStore(@CurrentUser() user: CurrentUserData) {
    return this.stores.getMyStore(user.id);
  }

  @Post('store')
  upsertStore(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpsertStoreDto,
  ) {
    return this.stores.upsertMyStore(user.id, dto);
  }

  // ─── Products ─────────────────────────────────────────────────────────────
  @Get('products')
  async listProducts(@CurrentUser() user: CurrentUserData) {
    const storeId = await this.stores.requireStoreId(user.id);
    return this.products.listForStore(storeId);
  }

  @Post('products')
  async createProduct(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateProductDto,
  ) {
    const storeId = await this.stores.requireStoreId(user.id);
    return this.products.create(storeId, dto);
  }

  @Patch('products/:id')
  async updateProduct(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    const storeId = await this.stores.requireStoreId(user.id);
    return this.products.update(storeId, id, dto);
  }

  @Delete('products/:id')
  async removeProduct(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    const storeId = await this.stores.requireStoreId(user.id);
    return this.products.remove(storeId, id);
  }

  // ─── Sales ────────────────────────────────────────────────────────────────
  @Get('orders')
  listOrders(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.orders.listForVendor(
      user.id,
      Number(page) || 1,
      Number(limit) || 24,
    );
  }

  @Get('earnings')
  earnings(@CurrentUser() user: CurrentUserData) {
    return this.orders.earningsForVendor(user.id);
  }
}
