import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(140) name: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) description: string;
  @Type(() => Number) @IsInt() @Min(1) priceNaira: number;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() compareAtNaira?: number;
  @IsString() @IsNotEmpty() @MaxLength(80) category: string;
  @IsString() @IsNotEmpty() @MaxLength(600) coverImage: string;

  @IsArray() @IsOptional() @IsString({ each: true }) gallery?: string[];
  @IsOptional() specs?: unknown; // [{label,value}]
  @IsOptional() options?: unknown; // [{label, values:[...]}]

  @IsString() @IsIn(['new', 'bestseller', 'sale']) @IsOptional() tag?: string;
  @IsBoolean() @IsOptional() bulkEligible?: boolean;
  @IsBoolean() @IsOptional() inStock?: boolean;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() stockQty?: number;
  @IsBoolean() @IsOptional() active?: boolean;
}

// Every field optional on update; the service only writes what is provided.
export class UpdateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(140) @IsOptional() name?: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) @IsOptional() description?: string;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() priceNaira?: number;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() compareAtNaira?: number;
  @IsString() @IsNotEmpty() @MaxLength(80) @IsOptional() category?: string;
  @IsString() @IsNotEmpty() @MaxLength(600) @IsOptional() coverImage?: string;
  @IsArray() @IsOptional() @IsString({ each: true }) gallery?: string[];
  @IsOptional() specs?: unknown;
  @IsOptional() options?: unknown;
  @IsString() @IsIn(['new', 'bestseller', 'sale']) @IsOptional() tag?: string;
  @IsBoolean() @IsOptional() bulkEligible?: boolean;
  @IsBoolean() @IsOptional() inStock?: boolean;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() stockQty?: number;
  @IsBoolean() @IsOptional() active?: boolean;
}
