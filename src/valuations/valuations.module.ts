import { Module } from '@nestjs/common';
import { ValuationsController } from './valuations.controller';
import { ValuationsService } from './valuations.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [ValuationsController],
  providers: [ValuationsService],
})
export class ValuationsModule {}
