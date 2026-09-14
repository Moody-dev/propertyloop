import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Chapter, StaffRole } from '../../../generated/prisma/client';

/**
 * A new staff member from the portal: the login account and the position
 * together. CreateStaffDto attaches a profile to an account that already
 * exists, which the portal has no way to name.
 */
export class ProvisionStaffDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @Length(1, 2)
  letter: string;

  @IsEnum(StaffRole)
  staffRole: StaffRole;

  @IsEnum(Chapter)
  chapter: Chapter;

  @IsEnum(Chapter)
  @IsOptional()
  secondaryChapter?: Chapter | null;

  @IsString()
  @IsOptional()
  reportsToId?: string | null;
}
