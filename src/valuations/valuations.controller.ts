import { Body, Controller, Post } from '@nestjs/common';
import { ValuationsService } from './valuations.service';
import { CreateValuationDto } from './dto/create-valuation.dto';

@Controller('valuations')
export class ValuationsController {
  constructor(private readonly service: ValuationsService) {}

  /**
   * Public endpoint — anyone visiting the Sell page can submit. The
   * request is forwarded to support.propertyloop@propertyloop.ng with the requester's
   * email set as Reply-To so a single reply goes straight to the homeowner.
   */
  @Post()
  submit(@Body() dto: CreateValuationDto) {
    return this.service.submit(dto);
  }
}
