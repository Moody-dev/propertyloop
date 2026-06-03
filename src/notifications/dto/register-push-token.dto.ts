import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  @MaxLength(255)
  token!: string;

  @IsString()
  @IsIn(['ios', 'android'])
  @IsOptional()
  platform?: 'ios' | 'android';
}
