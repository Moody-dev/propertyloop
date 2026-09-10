import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  Chapter,
  StaffPermission,
  StaffRole,
} from '../../../generated/prisma/client';

export class UpdateStaffDto {
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
