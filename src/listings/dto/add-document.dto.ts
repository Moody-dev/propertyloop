import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { DocumentType } from '../../../generated/prisma/client';

export class AddListingDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsEnum(DocumentType)
  type: DocumentType;

  @IsUrl()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  date?: string;
}
