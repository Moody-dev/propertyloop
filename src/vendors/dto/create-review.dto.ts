import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVendorReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment: string;

  /** Optional job context */
  @IsString()
  @IsOptional()
  jobId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  jobTitle?: string;

  /** Reviewer name when not authenticated */
  @IsString()
  @IsOptional()
  @MaxLength(120)
  reviewerName?: string;

  @IsString()
  @IsOptional()
  reviewerAvatar?: string;
}
