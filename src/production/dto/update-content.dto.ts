import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ContentChannel, ContentKind } from '../../../generated/prisma/client';

export class UpdateContentDto {
  @IsString()
  @MaxLength(300)
  @IsOptional()
  title?: string;

  @IsEnum(ContentChannel)
  @IsOptional()
  channel?: ContentChannel;

  @IsEnum(ContentKind)
  @IsOptional()
  kind?: ContentKind;

  @IsString()
  @IsOptional()
  ownerId?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  scheduledFor?: Date | null;

  /** Marks a scheduled piece as out now. */
  @IsBoolean()
  @IsOptional()
  publishNow?: boolean;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  engagementRate?: number | null;

  @IsInt()
  @Min(0)
  @IsOptional()
  leadsGenerated?: number;
}
