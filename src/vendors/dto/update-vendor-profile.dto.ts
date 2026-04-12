import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateVendorProfileDto {
  // User-level fields
  @IsString() @IsOptional() @MaxLength(120) name?: string;
  @IsString() @IsOptional() @MaxLength(40) phone?: string;
  @IsString() @IsOptional() @MaxLength(120) location?: string;
  @IsString() @IsOptional() @MaxLength(2000) bio?: string;
  @IsString() @IsOptional() avatarUrl?: string;

  // VendorProfile fields
  @IsString() @IsOptional() @MaxLength(120) serviceCategory?: string;
  @IsString() @IsOptional() @MaxLength(60) yearsExperience?: string;
  @IsString() @IsOptional() @MaxLength(200) serviceArea?: string;
  @IsString() @IsOptional() @MaxLength(60) priceLabel?: string;
  @IsInt() @Min(0) @IsOptional() priceNum?: number;
  @IsString() @IsOptional() bannerImage?: string;
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) @IsOptional()
  portfolioImages?: string[];
  @IsBoolean() @IsOptional() availableForHire?: boolean;
}
