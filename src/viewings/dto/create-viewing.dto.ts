import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateViewingDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  clientName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  clientPhone: string;

  @IsEmail()
  @IsOptional()
  clientEmail?: string;

  @Type(() => Date)
  @IsDate()
  scheduledFor: Date;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
