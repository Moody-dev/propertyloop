import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { OfferStatus } from '../../../generated/prisma/client';

export class ListOffersDto {
  @IsEnum(OfferStatus)
  @IsOptional()
  status?: OfferStatus;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  limit?: number;
}
