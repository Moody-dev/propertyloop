import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class SubmitKycDto {
  @IsString()
  @MaxLength(120)
  @IsOptional()
  fullName?: string;

  @IsString()
  @MaxLength(40)
  documentType!: string; // "NIN" | "Passport" | "Drivers License" | "Voters Card" | "CAC"

  @IsString()
  @MaxLength(60)
  @IsOptional()
  documentNumber?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUrl({}, { each: true })
  documentUrls!: string[];

  @IsUrl()
  @IsOptional()
  selfieUrl?: string;
}
