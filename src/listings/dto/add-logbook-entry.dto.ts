import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class AddLogbookEntryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  vendorName: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  cost: number;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  completedAt?: Date;
}
