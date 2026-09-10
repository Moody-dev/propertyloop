import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTaskDto {
  @IsString()
  @MaxLength(400)
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  assigneeId?: string | null;

  @IsBoolean()
  @IsOptional()
  urgent?: boolean;

  @IsBoolean()
  @IsOptional()
  resolved?: boolean;
}
