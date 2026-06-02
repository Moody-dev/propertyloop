import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PurchaseStepState } from '../../../generated/prisma/client';

export class UpdateStepDto {
  @IsEnum(PurchaseStepState)
  @IsOptional()
  state?: PurchaseStepState;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  detail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  eta?: string;
}
