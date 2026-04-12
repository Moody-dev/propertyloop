import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { LeadStatus } from '../../../generated/prisma/client';

export class UpdateLeadDto {
  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
