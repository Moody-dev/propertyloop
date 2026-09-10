import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { StaffPermissionsGuard } from './guards/staff-permissions.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [StaffController],
  // The guard is exported so every other team-portal module can apply it
  // without re-registering the Prisma dependency.
  providers: [StaffService, StaffPermissionsGuard],
  exports: [StaffService, StaffPermissionsGuard],
})
export class StaffModule {}
