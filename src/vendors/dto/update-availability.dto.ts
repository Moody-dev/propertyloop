import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ScheduleDayDto {
  @IsString()
  day!: string;

  @IsBoolean()
  on!: boolean;

  @IsString()
  @MaxLength(40)
  hours!: string;
}

export class UpdateAvailabilityDto {
  @IsBoolean()
  @IsOptional()
  acceptingBookings?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  maxJobsPerDay?: number;

  @IsString()
  @MaxLength(60)
  @IsOptional()
  responseCommitment?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  @IsOptional()
  schedule?: ScheduleDayDto[];
}
