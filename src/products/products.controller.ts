import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ListProductsDto } from './dto/list-products.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  list(@Query() query: ListProductsDto) {
    return this.service.list(query);
  }

  @Get('slug/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }
}
