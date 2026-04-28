import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAppWaitlistDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  source?: string;
}
