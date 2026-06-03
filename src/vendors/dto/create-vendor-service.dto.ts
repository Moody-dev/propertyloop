import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VendorServicePriceMode } from '../../../generated/prisma/client';

export class CreateVendorServiceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(400)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceNaira!: number;

  @IsEnum(VendorServicePriceMode)
  @IsOptional()
  priceMode?: VendorServicePriceMode;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  duration?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}
