import { Controller, Get, Param } from '@nestjs/common';
import { MarketplaceStoresService } from './stores.service';

@Controller('marketplace/stores')
export class MarketplaceStoresController {
  constructor(private readonly service: MarketplaceStoresService) {}

  @Get()
  list() {
    return this.service.listPublic();
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.service.getBySlugPublic(slug);
  }
}
