import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { StaffModule } from '../staff/staff.module';
import { StaffAlertsModule } from '../staff-alerts/staff-alerts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MarketplaceStoresService } from './stores.service';
import { MarketplaceProductsService } from './products.service';
import { MarketplaceOrdersService } from './orders.service';
import { MarketplaceDisputesService } from './disputes.service';
import { MarketplaceAdminService } from './admin.service';
import { MarketplaceStoresController } from './stores.controller';
import { MarketplaceProductsController } from './products.controller';
import { MarketplaceOrdersController } from './orders.controller';
import { MarketplaceVendorController } from './vendor.controller';
import { MarketplaceAdminController } from './admin.controller';

@Module({
  // PaymentsModule gives us PaystackService (checkout init + refunds) and
  // PaymentsService (webhook-side reconciliation). The dependency runs one way
  // only — PaymentsModule never imports this module — so there is no cycle.
  // StaffModule + StaffAlertsModule back the admin routes; NotificationsModule
  // powers buyer/vendor dispute and refund notifications.
  imports: [
    PrismaModule,
    AuthModule,
    PaymentsModule,
    StaffModule,
    StaffAlertsModule,
    NotificationsModule,
  ],
  controllers: [
    MarketplaceStoresController,
    MarketplaceProductsController,
    MarketplaceOrdersController,
    MarketplaceVendorController,
    MarketplaceAdminController,
  ],
  providers: [
    MarketplaceStoresService,
    MarketplaceProductsService,
    MarketplaceOrdersService,
    MarketplaceDisputesService,
    MarketplaceAdminService,
  ],
  exports: [MarketplaceStoresService, MarketplaceOrdersService],
})
export class MarketplaceModule {}
