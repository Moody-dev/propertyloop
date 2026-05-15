import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { NormalizePhone } from '../../common/phone';

export class UpdateAgentProfileDto {
  // User-level fields (proxied through to User)
  @IsString() @IsOptional() @MaxLength(120) name?: string;
  @NormalizePhone() @IsString() @IsOptional() @MaxLength(40) phone?: string;
  @IsString() @IsOptional() @MaxLength(120) location?: string;
  @IsString() @IsOptional() @MaxLength(2000) bio?: string;
  @IsString() @IsOptional() avatarUrl?: string;

  // AgentProfile fields
  @IsString() @IsOptional() @MaxLength(160) agencyName?: string;
  @IsString() @IsOptional() @MaxLength(200) businessAddress?: string;
  @IsInt() @Min(0) @IsOptional() yearsExperience?: number;
  @IsArray() @IsString({ each: true }) @IsOptional() specialty?: string[];
  @IsUrl() @IsOptional() website?: string;
}
