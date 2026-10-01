import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PartnerExperience } from '../../../generated/prisma/client';

/**
 * What a partner may change about themselves afterwards.
 *
 * Everything the registration form asks for except the email, which is the
 * login, and the referral code, which is history. Payout details are the point
 * of this: most people register without their bank account to hand and need
 * somewhere to add it later.
 *
 * Every field is optional and only what is sent is written, so a form that
 * shows one section cannot blank another.
 */
export class UpdatePartnerDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @IsOptional()
  @Matches(/^(\+?234|0)[789][01]\d{8}$/, {
    message: 'Enter a valid Nigerian phone number',
  })
  whatsapp?: string;

  @IsOptional()
  @IsEnum(PartnerExperience)
  experience?: PartnerExperience;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  agencyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  operatingState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  passportPhotoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  bankCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'An account number is 10 digits' })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'A NIN is 11 digits' })
  nin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  tin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  payerId?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  residentialAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  residentialState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  rcNumber?: string;
}
