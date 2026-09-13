import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { LeadSource } from '../../../generated/prisma/client';

export class CreateStaffLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone: string;

  /**
   * Website enquiries (LISTING_PAGE, AGENT_PROFILE) are written by the public
   * site when the form is submitted. Typing one in here would duplicate the
   * record and start the SLA clock from when somebody got round to it rather
   * than when the enquiry actually arrived.
   */
  @IsEnum(LeadSource)
  source: LeadSource;

  @IsString()
  @IsNotEmpty()
  propertyId: string;

  @IsString()
  @IsOptional()
  ownerId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  budgetNaira?: number;

  @IsBoolean()
  @IsOptional()
  qualified?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  notes?: string;
}
