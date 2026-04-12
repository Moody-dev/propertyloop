import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentType } from '../../../generated/prisma/client';

export class AddListingDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsEnum(DocumentType)
  type: DocumentType;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  date?: string;
}
