import { IsOptional, IsString, MaxLength } from 'class-validator';
import { NormalizePhone } from '../../common/phone';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @NormalizePhone()
  @IsString()
  @IsOptional()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  location?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  bio?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
