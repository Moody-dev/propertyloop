import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Chapter,
  DealKind,
  MandateType,
} from '../../../generated/prisma/client';

export class CreateDealDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  company: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  contactName: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  contactPhone?: string;

  @IsEnum(DealKind)
  kind: DealKind;

  @IsEnum(MandateType)
  @IsOptional()
  mandate?: MandateType;

  /** Expected commission or package value in whole naira. */
  @IsInt()
  @Min(0)
  @IsOptional()
  valueNaira?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  expectedUnits?: number;

  @IsString()
  @IsNotEmpty()
  ownerId: string;

  @IsEnum(Chapter)
  chapter: Chapter;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  nextAction?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  nextActionAt?: Date;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  notes?: string;
}
