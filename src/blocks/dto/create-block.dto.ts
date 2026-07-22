import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBlockDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  /** Why — surfaced to the team alongside the auto-filed report. */
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reason?: string;
}
