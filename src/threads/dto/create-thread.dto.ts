import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateThreadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  /** Everyone who should see it. The creator is added automatically. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  participantUserIds: string[];

  /** What the thread is about. Omit for a general discussion. */
  @IsIn(['LISTING', 'DEAL', 'LEAD', 'SHOOT', 'GENERAL'])
  @IsOptional()
  subject?: 'LISTING' | 'DEAL' | 'LEAD' | 'SHOOT' | 'GENERAL';

  @IsString()
  @IsOptional()
  subjectId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  firstMessage?: string;
}
