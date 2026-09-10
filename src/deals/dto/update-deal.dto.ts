import { PartialType } from '@nestjs/mapped-types';
import { IsEnum } from 'class-validator';
import { CreateDealDto } from './create-deal.dto';
import { DealStage } from '../../../generated/prisma/client';

export class UpdateDealDto extends PartialType(CreateDealDto) {}

export class SetDealStageDto {
  @IsEnum(DealStage)
  stage: DealStage;
}
