import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { MarketplaceStoresService } from './stores.service';
import { MarketplaceProductsService } from './products.service';
import { MarketplaceOrdersService } from './orders.service';
import { MarketplaceStoresController } from './stores.controller';
import { MarketplaceProductsController } from './products.controller';
import { MarketplaceOrdersController } from './orders.controller';
import { MarketplaceVendorController } from './vendor.controller';

@Module({
  // PaymentsModule gives us PaystackService (checkout init) and PaymentsService
  // (webhook-side reconciliation). The dependency runs one way only —
  // PaymentsModule never imports this module — so there is no cycle.
  imports: [PrismaModule, AuthModule, PaymentsModule],
  controllers: [
    MarketplaceStoresController,
    MarketplaceProductsController,
    MarketplaceOrdersController,
    MarketplaceVendorController,
  ],
  providers: [
    MarketplaceStoresService,
    MarketplaceProductsService,
    MarketplaceOrdersService,
  ],
  exports: [MarketplaceStoresService, MarketplaceOrdersService],
})
export class MarketplaceModule {}
