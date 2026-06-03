import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateVendorServiceDto } from './create-vendor-service.dto';

export class UpdateVendorServiceDto extends PartialType(
  CreateVendorServiceDto,
) {
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
