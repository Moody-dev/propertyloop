import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateShortletBookingDto {
  @IsString() @IsNotEmpty() listingId: string;
  @IsString() @IsNotEmpty() @MaxLength(120) guestName: string;
  @IsString() @IsNotEmpty() @MaxLength(40) guestPhone: string;
  @IsEmail() @IsOptional() guestEmail?: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(10) guests: number;
  @Type(() => Date) @IsDate() checkIn: Date;
  @Type(() => Date) @IsDate() checkOut: Date;

  @IsString() @IsOptional() @MaxLength(20) paymentMethod?: string;
}
