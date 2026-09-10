import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ContentChannel, ContentKind } from '../../../generated/prisma/client';

export class CreateContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @IsEnum(ContentChannel)
  channel: ContentChannel;

  @IsEnum(ContentKind)
  kind: ContentKind;

  @IsString()
  @IsNotEmpty()
  ownerId: string;

  /** Omit to publish immediately. */
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  scheduledFor?: Date;
}
