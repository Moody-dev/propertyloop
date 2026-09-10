import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateShootDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  location: string;

  @IsString()
  @IsOptional()
  listingId?: string;

  @IsString()
  @IsNotEmpty()
  presenterId: string;

  @IsString()
  @IsNotEmpty()
  secretaryId: string;

  /** Omit to leave the shoot in Requested until a date is booked. */
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  scheduledFor?: Date;
}
