import { Type } from 'class-transformer';
import {
  MinLength,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PartnerExperience } from '../../../generated/prisma/client';

/**
 * Public registration for the Agent Partner Programme.
 *
 * Only name, WhatsApp and email are required. The payout half is optional in
 * full: asking a stranger for their NIN and bank details before they have
 * agreed to anything loses most of them on the first screen, so a partner can
 * register now and complete it before their first commission.
 */
export class RegisterPartnerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  /// Nigerian mobile, local or +234. Normalised to E.164 by the service.
  @IsString()
  @Matches(/^(\+?234|0)[789][01]\d{8}$/, {
    message: 'Enter a valid Nigerian phone number',
  })
  whatsapp: string;

  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @IsEnum(PartnerExperience)
  @IsOptional()
  experience?: PartnerExperience;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  agencyName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  operatingState?: string;

  /// Partner code of whoever shared the link. An unknown code is ignored
  /// rather than rejected — an uncredited referral is recoverable, a lost
  /// registration is not.
  @IsString()
  @IsOptional()
  @MaxLength(16)
  referredByCode?: string;

  @IsBoolean()
  @Type(() => Boolean)
  consentedToTerms: boolean;

  /**
   * The password they will sign in with. Optional only because somebody
   * who already has a PropertyLoop account keeps the one they have — a
   * registration cannot change an existing account's password.
   */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Include a capital letter, a small letter and a number',
  })
  password?: string;

  // ─── Payout, all optional ──────────────────────────────────────────────

  @IsString()
  @IsOptional()
  passportPhotoUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  bankCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  bankName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'Account numbers are 10 digits' })
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  accountName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'A NIN is 11 digits' })
  nin?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  tin?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  payerId?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  @MaxLength(240)
  residentialAddress?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  residentialState?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  rcNumber?: string;
}
