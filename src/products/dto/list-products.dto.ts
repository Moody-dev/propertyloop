import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListProductsDto {
  @IsString() @IsOptional() search?: string;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() location?: string;

  @IsString()
  @IsIn(['newest', 'price_asc', 'price_desc', 'top_rated'])
  @IsOptional()
  sort?: string;

  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() limit?: number = 24;
}
