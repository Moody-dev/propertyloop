import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  Chapter,
  StaffPermission,
  StaffRole,
} from '../../../generated/prisma/client';

export class UpdateStaffDto {
  /** Lives on the User row; the service writes it there. */
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  /** The sign-in address. Unique across every account, not just staff. */
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @Length(1, 2)
  @IsOptional()
  letter?: string;

  @IsEnum(StaffRole)
  @IsOptional()
  staffRole?: StaffRole;

  @IsEnum(Chapter)
  @IsOptional()
  chapter?: Chapter;

  @IsEnum(Chapter)
  @IsOptional()
  secondaryChapter?: Chapter | null;

  @IsString()
  @IsOptional()
  reportsToId?: string | null;

  @IsArray()
  @ArrayUnique()
  @IsEnum(StaffPermission, { each: true })
  @IsOptional()
  permissions?: StaffPermission[];
}

export class SetStaffActiveDto {
  @IsBoolean()
  active: boolean;
}
