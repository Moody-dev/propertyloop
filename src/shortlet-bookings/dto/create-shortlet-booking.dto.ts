import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsIn,
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
  // Optional for signed-in guests — filled from the profile by the service.
  @IsString() @MaxLength(120) @IsOptional() guestName?: string;
  @IsString() @MaxLength(40) @IsOptional() guestPhone?: string;
  @IsEmail() @IsOptional() guestEmail?: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(10) guests: number;
  @Type(() => Date) @IsDate() checkIn: Date;
  @Type(() => Date) @IsDate() checkOut: Date;

  @IsOptional() @IsIn(['CARD', 'TRANSFER', 'WALLET']) paymentMethod?: string;
}
