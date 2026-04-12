import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  ListingStatus,
  ListingType,
} from '../../../generated/prisma/client';

export type ListingSort = 'newest' | 'price_asc' | 'price_desc' | 'top_rated';

export class ListListingsDto {
  @IsEnum(ListingType)
  @IsOptional()
  type?: ListingType;

  @IsString()
  @IsOptional()
  propertyType?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minBeds?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minBaths?: number;

  @IsEnum(ListingStatus)
  @IsOptional()
  status?: ListingStatus;

  @IsString()
  @IsIn(['newest', 'price_asc', 'price_desc', 'top_rated'])
  @IsOptional()
  sort?: ListingSort;

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
