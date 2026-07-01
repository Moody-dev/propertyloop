import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveDisputeDto {
  // `release` pays the vendor; `refund` returns the money to the customer.
  @IsIn(['release', 'refund'])
  outcome: 'release' | 'refund';

  // Optional note appended to the resolution message shown to both parties.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
