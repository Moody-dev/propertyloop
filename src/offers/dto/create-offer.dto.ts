import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { OfferFinancing } from '../../../generated/prisma/client';

export class CreateOfferDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  /** Offer amount in whole naira. */
  @IsInt()
  @IsPositive()
  amountNaira: number;

  @IsEnum(OfferFinancing)
  @IsOptional()
  financing?: OfferFinancing;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  closeDate?: Date;

  @IsBoolean()
  @IsOptional()
  subjectToInspection?: boolean;

  /** Optional buyer-set deadline for the agent to respond. */
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  expiresAt?: Date;
}
