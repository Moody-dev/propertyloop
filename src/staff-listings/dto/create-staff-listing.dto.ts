import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
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

/**
 * A property posted from the portal.
 *
 * The public-listing fields match the website's agent upload form, and the
 * limits match CreateListingDto, field for field — so PropertyLoop's own stock
 * reaches the website and the apps as complete as any agent's listing. The
 * rest (chapter, units, mandate) are what only the company records.
 */
export class CreateStaffListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsEnum(ListingType)
  type: ListingType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  propertyType: string;

  // Not IsInt: a Banana Island mandate runs to billions, and the value arrives
  // as a JSON number.
  @IsNumber()
  @Min(0)
  priceNaira: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  address: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  location: string;

  @IsInt()
  @Min(0)
  beds: number;

  @IsInt()
  @Min(0)
  baths: number;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  sqft?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  yearBuilt?: string;

  /** Rich text from the editor. Sanitised by the service before it is stored. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  description: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(40)
  @IsOptional()
  features?: string[];

  @IsUrl()
  @IsOptional()
  virtualTourUrl?: string;

  /** Pasted YouTube / Vimeo links. Uploaded video files arrive separately. */
  @IsArray()
  @IsUrl({}, { each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  videoUrls?: string[];

  @IsEnum(Chapter)
  chapter: Chapter;

  @IsInt()
  @Min(1)
  @IsOptional()
  units?: number;

  /** The mandate this stock came in under, if any. */
  @IsString()
  @IsOptional()
  dealId?: string | null;

  /** Documents received on paper, before any file is uploaded. */
  @IsArray()
  @ArrayUnique()
  @IsEnum(DocumentType, { each: true })
  @IsOptional()
  documentsPresent?: DocumentType[];
}
