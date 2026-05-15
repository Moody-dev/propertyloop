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
}

export class AgentSignupDataDto {
  @IsString()
  @IsNotEmpty()
  agencyName: string;

  @IsString()
  @IsNotEmpty()
  licenseNumber: string;

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
