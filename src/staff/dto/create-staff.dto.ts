import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  Chapter,
  StaffPermission,
  StaffRole,
} from '../../../generated/prisma/client';

export class CreateStaffDto {
  /** The existing user account this position belongs to. */
  @IsString()
  @IsNotEmpty()
  userId: string;

  /** "A"–"G", the letter used throughout the org document. */
  @IsString()
  @Length(1, 2)
  letter: string;

  @IsEnum(StaffRole)
  staffRole: StaffRole;

  @IsEnum(Chapter)
  chapter: Chapter;

  @IsEnum(Chapter)
  @IsOptional()
  secondaryChapter?: Chapter;

  @IsString()
  @IsOptional()
  reportsToId?: string;

  /** Omit to take the defaults for the position. */
  @IsArray()
  @ArrayUnique()
  @IsEnum(StaffPermission, { each: true })
  @IsOptional()
  permissions?: StaffPermission[];
}
