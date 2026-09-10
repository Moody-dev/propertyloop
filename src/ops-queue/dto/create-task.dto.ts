import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  subject: string;

  @IsString()
  @IsOptional()
  assigneeId?: string;

  @IsBoolean()
  @IsOptional()
  urgent?: boolean;

  /**
   * Only TASK is accepted. Present so a client that tries to create a payout
   * or a KYC row gets a clear refusal naming the model those come from,
   * rather than silently succeeding against the wrong table.
   */
  @IsIn(['TASK'])
  @IsOptional()
  kind?: string = 'TASK';
}
