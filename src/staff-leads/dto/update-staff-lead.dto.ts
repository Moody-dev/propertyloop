import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { LeadSource, LeadStatus } from '../../../generated/prisma/client';

export class UpdateStaffLeadDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  phone?: string;

  @IsEnum(LeadSource)
  @IsOptional()
  source?: LeadSource;

  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @IsString()
  @IsOptional()
  propertyId?: string;

  @IsString()
  @IsOptional()
  ownerId?: string;

  // Nullable on purpose: clearing a budget is a real edit, distinct from not
  // touching the field.
  @IsInt()
  @Min(0)
  @IsOptional()
  budgetNaira?: number | null;

  @IsBoolean()
  @IsOptional()
  qualified?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  notes?: string;
}
