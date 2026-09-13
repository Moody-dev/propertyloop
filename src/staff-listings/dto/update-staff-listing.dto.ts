import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Chapter, ListingType } from '../../../generated/prisma/client';

export class UpdateStaffListingDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  location?: string;

  @IsEnum(Chapter)
  @IsOptional()
  chapter?: Chapter;

  @IsEnum(ListingType)
  @IsOptional()
  type?: ListingType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  priceNaira?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  units?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  unitsSold?: number;

  // Nullable: unlinking a property from its mandate is a real edit.
  @IsString()
  @IsOptional()
  dealId?: string | null;
}
