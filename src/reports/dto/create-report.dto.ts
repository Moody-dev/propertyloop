import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ReportTargetType } from '../../../generated/prisma/client';

export class CreateReportDto {
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @IsString()
  @IsNotEmpty()
  targetId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}
