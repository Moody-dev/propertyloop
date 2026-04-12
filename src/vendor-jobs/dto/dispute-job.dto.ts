import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class DisputeJobDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  disputeReason: string;
}
