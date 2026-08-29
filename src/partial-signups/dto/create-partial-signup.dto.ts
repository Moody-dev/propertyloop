import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '../../../generated/prisma/client';

/**
 * Deliberately narrow. The signup forms hold the password in the same state
 * object as these fields, so anything not listed here must be rejected rather
 * than quietly persisted — the global ValidationPipe runs with
 * forbidNonWhitelisted, which turns a stray `password` key into a 400.
 */
export class CreatePartialSignupDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  phone?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  step?: string;

  @IsIn(['web', 'mobile'])
  @IsOptional()
  source?: string;
}
