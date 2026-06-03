import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateBuyerProfileDto {
  @IsString()
  @MaxLength(40)
  @IsOptional()
  lookingFor?: string; // "Buy a home" | "Rent a home" | "Shortlet stay" | "Just browsing"

  @IsString()
  @MaxLength(300)
  @IsOptional()
  preferredLocations?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  budgetRange?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  budgetMin?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  budgetMax?: number;
}
