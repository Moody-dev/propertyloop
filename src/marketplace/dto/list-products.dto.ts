import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListMarketplaceProductsDto {
  @IsString() @IsOptional() search?: string;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() storeSlug?: string;

  @IsString()
  @IsIn(['newest', 'price_asc', 'price_desc', 'top_rated', 'popular'])
  @IsOptional()
  sort?: string;

  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() limit?: number = 24;
}
