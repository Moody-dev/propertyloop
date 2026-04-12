import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ViewingStatus } from '../../../generated/prisma/client';

export class UpdateViewingDto {
  @IsEnum(ViewingStatus)
  @IsOptional()
  status?: ViewingStatus;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  scheduledFor?: Date;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
