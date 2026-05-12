import { IsArray, IsOptional, IsString, IsUrl, MaxLength, ArrayMaxSize } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  @ArrayMaxSize(10)
  attachmentUrls?: string[];
}
