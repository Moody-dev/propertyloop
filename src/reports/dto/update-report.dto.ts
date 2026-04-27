import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportStatus } from '../../../generated/prisma/client';

export class UpdateReportDto {
  @IsEnum(ReportStatus)
  @IsOptional()
  status?: ReportStatus;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  adminNote?: string;
}
