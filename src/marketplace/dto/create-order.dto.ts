import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateMarketplaceOrderItemDto {
  @IsString() @IsNotEmpty() productId: string;
  @Type(() => Number) @IsInt() @Min(1) quantity: number;

  // Selected variant, e.g. { "Colour": "Olive" }. Free-form but capped by the
  // controller's global validation pipe (whitelist strips unknown top-level keys).
  @IsObject() @IsOptional() options?: Record<string, string>;
}

export class CreateMarketplaceOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(120) buyerName: string;
  @IsEmail() @MaxLength(160) buyerEmail: string;
  @IsString() @IsNotEmpty() @MaxLength(40) buyerPhone: string;

  @IsString() @IsNotEmpty() @MaxLength(240) address: string;
  @IsString() @IsNotEmpty() @MaxLength(80) city: string;
  @IsString() @IsNotEmpty() @MaxLength(80) state: string;
  @IsString() @IsOptional() @MaxLength(500) notes?: string;

  // Mobile/web callers can pass their own return URL (deep link or page). The
  // service wraps a mobile scheme in the https bounce; web callers get the
  // default marketplace confirmation page.
  @IsString() @IsOptional() @MaxLength(400) returnUrl?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateMarketplaceOrderItemDto)
  items: CreateMarketplaceOrderItemDto[];
}
