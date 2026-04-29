import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export type AgentSort =
  | 'top_rated'
  | 'most_listings'
  | 'most_deals'
  | 'top_performers'
  | 'newest';

export class ListAgentsDto {
  @IsString()
  @IsOptional()
  search?: string;

  /** Single specialty token like "Buy", "Rent", "Shortlet", "Commercial" */
  @IsString()
  @IsOptional()
  specialty?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @Type(() => Number)
  @IsOptional()
  minRating?: number;

  @IsString()
  @IsIn(['top_rated', 'most_listings', 'most_deals', 'top_performers', 'newest'])
  @IsOptional()
  sort?: AgentSort;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 24;
}
