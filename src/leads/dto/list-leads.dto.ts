import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { LeadStatus } from '../../../generated/prisma/client';

export class ListLeadsDto {
  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 24;
}
