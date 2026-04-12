import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LeadSource } from '../../../generated/prisma/client';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  message?: string;

  @IsEnum(LeadSource)
  @IsOptional()
  source?: LeadSource;
}
