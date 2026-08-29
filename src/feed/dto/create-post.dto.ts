import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { FeedPostType } from '../../../generated/prisma/client';

export class CreateFeedPostDto {
  @IsEnum(FeedPostType)
  @IsOptional()
  type?: FeedPostType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(4)
  @IsOptional()
  images?: string[];

  // One clip per post. Images and videos are mutually exclusive — createPost
  // drops images when a video is present rather than rejecting the post.
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1)
  @IsOptional()
  videos?: string[];

  @IsString()
  @IsOptional()
  listingId?: string;

  // Market-insight card
  @IsString()
  @IsOptional()
  @MaxLength(120)
  insightMetric?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  insightPeriod?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  insightDelta?: string;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(100, { each: true })
  @ArrayMaxSize(12)
  @IsOptional()
  insightBars?: number[];

  // Completed-project card
  @IsString()
  @IsOptional()
  @MaxLength(120)
  projectName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  projectLocation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  projectUnits?: string;

  // Poll — 2 to 6 options; poll runs for 3 days from creation
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(6)
  @IsOptional()
  pollOptions?: string[];
}
