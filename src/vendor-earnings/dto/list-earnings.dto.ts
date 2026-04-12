import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { EarningStatus } from '../../../generated/prisma/client';

export class ListEarningsDto {
  @IsEnum(EarningStatus)
  @IsOptional()
  status?: EarningStatus;

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
