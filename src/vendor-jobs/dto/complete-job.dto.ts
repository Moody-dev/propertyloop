import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteJobDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  completionNotes?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  completionProofImages?: string[];
}
