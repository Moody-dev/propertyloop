import { Controller, Get, Param, Query } from '@nestjs/common';
import { MarketplaceProductsService } from './products.service';
import { ListMarketplaceProductsDto } from './dto/list-products.dto';

@Controller('marketplace/products')
export class MarketplaceProductsController {
  constructor(private readonly service: MarketplaceProductsService) {}

  @Get()
  list(@Query() query: ListMarketplaceProductsDto) {
    return this.service.listPublic(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getByIdPublic(id);
  }
}
