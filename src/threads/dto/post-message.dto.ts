import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PostMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text: string;
}
