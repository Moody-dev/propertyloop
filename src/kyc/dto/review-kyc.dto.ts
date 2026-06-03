import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewKycDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsString()
  @MaxLength(300)
  @IsOptional()
  rejectionReason?: string;
}
