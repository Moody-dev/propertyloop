import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { JobStatus } from '../../../generated/prisma/client';

export class ListJobsDto {
  @IsEnum(JobStatus)
  @IsOptional()
  status?: JobStatus;

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
