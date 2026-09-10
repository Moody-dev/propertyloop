import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class SaveDailyLogDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  summary: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  blockers?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  plan?: string;
}

/** YYYY-MM-DD, validated so a malformed day cannot create a junk row. */
export class DayParamDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day must be YYYY-MM-DD' })
  day: string;
}
