import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFeedCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;

  @IsString()
  @IsOptional()
  parentId?: string;
}
