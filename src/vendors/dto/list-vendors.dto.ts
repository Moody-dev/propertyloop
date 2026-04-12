import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export type VendorSort = 'top_rated' | 'most_jobs' | 'price_asc' | 'newest';

export class ListVendorsDto {
  @IsString()
  @IsOptional()
  search?: string;

  /** Service category like "Plumbing", "Electrical" */
  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @Type(() => Number)
  @IsOptional()
  minRating?: number;

  @IsString()
  @IsIn(['top_rated', 'most_jobs', 'price_asc', 'newest'])
  @IsOptional()
  sort?: VendorSort;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 24;
}
