import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateViewingDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  // Contact details are optional for signed-in buyers — the service fills them
  // from the authenticated user's profile. Guests must supply them.
  @IsString()
  @MaxLength(120)
  @IsOptional()
  clientName?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  clientPhone?: string;

  @IsEmail()
  @IsOptional()
  clientEmail?: string;

  @Type(() => Date)
  @IsDate()
  scheduledFor: Date;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
