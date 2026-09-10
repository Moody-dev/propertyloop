import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Chapter, DealKind, DealStage } from '../../../generated/prisma/client';

export class ListDealsDto {
  @IsEnum(DealStage)
  @IsOptional()
  stage?: DealStage;

  @IsEnum(DealKind)
  @IsOptional()
  kind?: DealKind;

  @IsEnum(Chapter)
  @IsOptional()
  chapter?: Chapter;

  @IsString()
  @IsOptional()
  ownerId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  search?: string;
}
