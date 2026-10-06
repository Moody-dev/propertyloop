import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Vendor-editable storefront fields. A vendor owns exactly one store, so there
 * is no create/update split — the service upserts on the authenticated user.
 * commissionPct is intentionally absent: only an admin sets a store's rate.
 */
export class UpsertStoreDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsString() @IsNotEmpty() @MaxLength(160) tagline: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) bio: string;
  @IsString() @IsNotEmpty() @MaxLength(600) logo: string;
  @IsString() @IsNotEmpty() @MaxLength(600) banner: string;
  @IsHexColor() @IsOptional() accent?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) category: string;
  @IsString() @IsNotEmpty() @MaxLength(120) location: string;
  @IsString() @IsNotEmpty() @MaxLength(40) phone: string;
  @IsEmail() @MaxLength(160) email: string;
  @IsString() @IsOptional() @MaxLength(20) established?: string;

  @IsString() @IsOptional() @MaxLength(60) responseTime?: string;

  @IsArray() @IsOptional() @IsString({ each: true }) deliveryAreas?: string[];

  // JSON blobs shaped by the storefront UI. Validated loosely here; the service
  // trusts the vendor for presentation-only data.
  @IsOptional() policies?: unknown;
  @IsOptional() promo?: unknown;
  @IsOptional() collections?: unknown;

  // Admin-only knobs — rejected from the vendor controller, accepted on the
  // admin path. Kept in one DTO so the shapes can't drift apart.
  @IsInt() @Min(0) @Max(50) @IsOptional() commissionPct?: number;
  @IsBoolean() @IsOptional() verified?: boolean;
  @IsBoolean() @IsOptional() active?: boolean;
}
