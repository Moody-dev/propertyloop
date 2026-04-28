import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  vendorId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  address: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  category?: string;

  /** Naira amount the vendor receives */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  vendorFee: number;

  @Type(() => Date)
  @IsDate()
  scheduledFor: Date;

  // Contact snapshot (always required — could be logged-in buyer or guest)
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

  @IsString()
  @IsOptional()
  @MaxLength(20)
  paymentMethod?: string;

  /** Image/video URLs that the buyer uploaded with the request */
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(8)
  @IsUrl({}, { each: true })
  attachments?: string[];
}
