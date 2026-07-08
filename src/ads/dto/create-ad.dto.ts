import {
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AdPlacement } from '../../../generated/prisma/client';

export class CreateAdDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  brandName: string;

  @IsEmail()
  contactEmail: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @IsUrl()
  imageUrl: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(90)
  headline: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  ctaLabel?: string;

  @IsUrl()
  ctaUrl: string;

  @IsEnum(AdPlacement)
  placement: AdPlacement;

  // Desired go-live date. If review lands after it, the window shifts forward.
  @IsISO8601()
  startAt: string;

  @IsInt()
  @Min(1)
  @Max(12)
  weeks: number;
}
