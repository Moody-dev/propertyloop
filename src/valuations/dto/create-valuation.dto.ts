import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { NormalizePhone } from '../../common/phone';

export class CreateValuationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  address: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  propertyType?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  beds?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  baths?: number;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  estimatedValue?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  @NormalizePhone()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone: string;

  @IsEmail()
  @MaxLength(254)
  email: string;
}
