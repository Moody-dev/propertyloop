import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

/** A browser PushSubscription, flattened: endpoint plus its two keys. */
export class PushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  endpoint: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  auth: string;
}

export class RemovePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint: string;
}
