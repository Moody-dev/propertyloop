import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

/** A buyer opening a dispute on their order. */
export class RaiseDisputeDto {
  @IsString() @IsNotEmpty() @MaxLength(120) reason: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) details: string;
}

/** An admin resolving a dispute: refund (full/partial) or reject. */
export class ResolveDisputeDto {
  @IsIn(['refund', 'reject']) action: 'refund' | 'reject';
  // Omit for a full refund; a value issues a partial refund of that many naira.
  @IsInt() @Min(1) @IsOptional() refundNaira?: number;
  @IsString() @IsOptional() @MaxLength(2000) note?: string;
}

/** An admin refunding an order directly, without a dispute. */
export class RefundOrderDto {
  @IsInt() @Min(1) @IsOptional() refundNaira?: number;
  @IsString() @IsOptional() @MaxLength(2000) reason?: string;
}

/** An admin updating a store's verification / status / commission. */
export class AdminUpdateStoreDto {
  @IsOptional() verified?: boolean;
  @IsOptional() active?: boolean;
  // null clears the override (store falls back to category commission rates).
  @IsOptional() @IsInt() @Min(0) commissionPctOverride?: number | null;
}
