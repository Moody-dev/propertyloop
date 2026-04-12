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
  @IsNotEmpty()
  @MaxLength(20)
  yearBuilt: string;

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
}
