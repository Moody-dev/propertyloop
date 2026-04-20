import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRentalApplicationDto {
  @IsString() @IsNotEmpty() listingId: string;
  @IsString() @IsNotEmpty() @MaxLength(120) applicantName: string;
  @IsString() @IsNotEmpty() @MaxLength(40) applicantPhone: string;
  @IsEmail() @IsOptional() applicantEmail?: string;

  /** Annual rent in naira (deposit amount) */
  @Type(() => Number) @IsInt() @Min(0) deposit: number;
  /** Agency fee in naira (typically 10% of deposit) */
  @Type(() => Number) @IsInt() @Min(0) agencyFee: number;
  /** Legal/agreement fee in naira */
  @Type(() => Number) @IsInt() @Min(0) legalFee: number;

  @IsString() @IsNotEmpty() @MaxLength(40) leaseDuration: string;
  @Type(() => Date) @IsDate() startDate: Date;

  @IsOptional() @IsIn(['CARD', 'TRANSFER', 'WALLET']) paymentMethod?: string;
}
