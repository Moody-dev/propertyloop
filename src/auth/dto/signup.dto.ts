import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '../../../generated/prisma/client';
import { NormalizePhone } from '../../common/phone';

export class BuyerSignupDataDto {
  @IsString()
  @IsOptional()
  preferredLocations?: string;

  /** e.g. "Rent a home" | "Buy a home" | "Just browsing" — from onboarding intent */
  @IsString()
  @IsOptional()
  lookingFor?: string;

  /** e.g. "₦1M – ₦3M / yr" or "₦50M – ₦100M" — from the onboarding budget picker */
  @IsString()
  @IsOptional()
  budgetRange?: string;
}

export class AgentSignupDataDto {
  @IsString()
  @IsNotEmpty()
  agencyName: string;

  // Optional — agents can register without a CAC/RC or professional
  // registration number. Left blank, it's stored as NULL.
  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsString()
  @IsNotEmpty()
  businessAddress: string;
}

export class VendorSignupDataDto {
  @IsString()
  @IsNotEmpty()
  serviceCategory: string;

  @IsString()
  @IsNotEmpty()
  yearsExperience: string;

  @IsString()
  @IsNotEmpty()
  serviceArea: string;
}

export class SignupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  @NormalizePhone()
  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(Role)
  role: Role;

  /**
   * Referral code of the user who shared their link
   * (onboarding?ref=<code>). Invalid/unknown codes are silently ignored —
   * a bad code must never block a signup.
   */
  @IsString()
  @IsOptional()
  referralCode?: string;

  @ValidateNested()
  @Type(() => BuyerSignupDataDto)
  @IsOptional()
  buyer?: BuyerSignupDataDto;

  @ValidateNested()
  @Type(() => AgentSignupDataDto)
  @IsOptional()
  agent?: AgentSignupDataDto;

  @ValidateNested()
  @Type(() => VendorSignupDataDto)
  @IsOptional()
  vendor?: VendorSignupDataDto;
}
