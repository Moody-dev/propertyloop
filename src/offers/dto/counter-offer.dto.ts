import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CounterOfferDto {
  /** Counter amount in whole naira. */
  @IsInt()
  @IsPositive()
  amountNaira: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;
}
