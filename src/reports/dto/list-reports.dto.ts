import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ReportStatus, ReportTargetType } from '../../../generated/prisma/client';

export class ListReportsDto {
  @IsEnum(ReportStatus)
  @IsOptional()
  status?: ReportStatus;

  @IsEnum(ReportTargetType)
  @IsOptional()
  targetType?: ReportTargetType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 50;
}
