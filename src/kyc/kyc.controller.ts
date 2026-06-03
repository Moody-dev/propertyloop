import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { KycService } from './kyc.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post()
  submit(@CurrentUser() user: CurrentUserData, @Body() dto: SubmitKycDto) {
    return this.kycService.submit(user.id, dto);
  }

  @Get('me')
  getMine(@CurrentUser() user: CurrentUserData) {
    return this.kycService.getMine(user.id);
  }
}
