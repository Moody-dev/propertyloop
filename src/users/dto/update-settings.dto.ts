import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  // Notifications
  @IsBoolean() @IsOptional() notifEmail?: boolean;
  @IsBoolean() @IsOptional() notifSms?: boolean;
  @IsBoolean() @IsOptional() notifMessages?: boolean;
  @IsBoolean() @IsOptional() notifPriceAlerts?: boolean;
  @IsBoolean() @IsOptional() notifMarketing?: boolean;

  // Privacy
  @IsBoolean() @IsOptional() profileVisible?: boolean;
  @IsBoolean() @IsOptional() shareActivity?: boolean;

  // Preferences
  @IsString() @IsOptional() language?: string;
  @IsString() @IsOptional() @IsIn(['NGN', 'USD', 'GBP', 'EUR']) currency?: string;

  // Security
  @IsBoolean() @IsOptional() twoFactorEnabled?: boolean;
}
