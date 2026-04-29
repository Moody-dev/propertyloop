import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ListingType } from '../../../generated/prisma/client';

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsEnum(ListingType)
  type: ListingType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  propertyType: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000_000, {
    message: 'priceNaira must be ₦100,000,000,000 or less',
  })
  priceNaira: number;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  period?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  address: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  location: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  beds: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  baths: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  sqft: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  yearBuilt?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(40)
  features: string[];

  @IsString()
  @IsNotEmpty()
  coverImage: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  images: string[];

  @IsUrl()
  @IsOptional()
  virtualTourUrl?: string;

  @IsUrl()
  @IsOptional()
  videoUrl?: string;
}
