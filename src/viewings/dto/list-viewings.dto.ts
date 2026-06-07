import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ViewingStatus } from '../../../generated/prisma/client';

export class ListViewingsDto {
  @IsEnum(ViewingStatus)
  @IsOptional()
  status?: ViewingStatus;

  /**
   * When true, only return viewings scheduled in the future.
   * NOTE: a plain `@Type(() => Boolean)` turns the string "false" into `true`
   * (Boolean("false") === true), so parse the string explicitly.
   */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  upcoming?: boolean;

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
