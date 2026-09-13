import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Chapter,
  DocumentType,
  ListingType,
} from '../../../generated/prisma/client';

export class CreateStaffListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  location: string;

  @IsEnum(Chapter)
  chapter: Chapter;

  @IsEnum(ListingType)
  type: ListingType;

  // Not IsInt: a Banana Island mandate runs to billions, and the value arrives
  // as a JSON number.
  @IsNumber()
  @Min(0)
  priceNaira: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  units?: number;

  /** The mandate this stock came in under, if any. */
  @IsString()
  @IsOptional()
  dealId?: string | null;

  /*
   * Listing is shared with the public website and requires these. The staff
   * form does not ask for them — a mandate is signed on price and unit count,
   * not bathrooms — so they are optional here and defaulted by the service.
   */
  @IsString()
  @IsOptional()
  @MaxLength(80)
  propertyType?: string;

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
  @MaxLength(8000)
  description?: string;

  /** Which of the four documents the owner has actually handed over. */
  @IsArray()
  @ArrayUnique()
  @IsEnum(DocumentType, { each: true })
  @IsOptional()
  documentsPresent?: DocumentType[];
}
