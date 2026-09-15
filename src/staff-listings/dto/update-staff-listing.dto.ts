import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Chapter,
  DocumentType,
  ListingType,
} from '../../../generated/prisma/client';

/** The same fields as creating, all optional. Media changes have their own routes. */
export class UpdateStaffListingDto {
  @IsString()
  @IsOptional()
  @MaxLength(160)
  title?: string;

  @IsEnum(ListingType)
  @IsOptional()
  type?: ListingType;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  propertyType?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  priceNaira?: number;

  @IsString()
  @IsOptional()
  @MaxLength(240)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  location?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  beds?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  baths?: number;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  sqft?: string;

  // An empty string clears it.
  @IsString()
  @IsOptional()
  @MaxLength(20)
  yearBuilt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(8000)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(40)
  @IsOptional()
  features?: string[];

  // Nullable: removing a virtual tour is a real edit.
  @IsUrl()
  @IsOptional()
  virtualTourUrl?: string | null;

  @IsEnum(Chapter)
  @IsOptional()
  chapter?: Chapter;

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

  /**
   * Which of the four documents are now on file. Un-ticking one removes it,
   * and its verification with it — a document no longer held cannot stay
   * checked.
   */
  @IsArray()
  @ArrayUnique()
  @IsEnum(DocumentType, { each: true })
  @IsOptional()
  documentsPresent?: DocumentType[];
}
