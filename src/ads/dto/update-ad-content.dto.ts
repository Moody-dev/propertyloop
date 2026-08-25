import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Admin edit of a live ad's creative. Deliberately narrow: only the things a
 * brand might ask us to correct mid-flight (a better image, copy they supplied
 * late, a changed landing page). Placement, dates, money and status stay out —
 * those change what was paid for, and status has its own reviewed route.
 *
 * Every field is optional; whatever is present is what gets written.
 */
export class UpdateAdContentDto {
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(90)
  headline?: string;

  // Empty string is meaningful here — it clears a body back to nothing.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  body?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  ctaLabel?: string;

  @IsOptional()
  @IsUrl()
  ctaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;
}
