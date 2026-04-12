import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateAgentReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment: string;

  /** Reviewer name when not authenticated */
  @IsString()
  @IsOptional()
  @MaxLength(120)
  reviewerName?: string;
}
