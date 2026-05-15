import { IsEmail, IsNotEmpty, IsOptional, IsString, IsEnum } from "class-validator";
import { UserType } from "../../../generated/prisma/client";
import { NormalizePhone } from "../../common/phone";

export class CreateWaitlistDto {
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsString()
  @IsOptional()
  company_name?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @NormalizePhone()
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsEnum(UserType)
  @IsNotEmpty()
  type: UserType;
}