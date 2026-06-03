import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AddBlackoutDto {
  /** ISO date strings, e.g. ["2026-06-12", "2026-06-13"]. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(366)
  @IsISO8601({ strict: false }, { each: true })
  dates!: string[];

  @IsString()
  @MaxLength(120)
  @IsOptional()
  reason?: string;
}
