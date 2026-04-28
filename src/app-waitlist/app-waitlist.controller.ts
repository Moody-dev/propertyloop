import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { AppWaitlistService } from './app-waitlist.service';
import { CreateAppWaitlistDto } from './dto/create-app-waitlist.dto';

@Controller('app-waitlist')
export class AppWaitlistController {
  constructor(private readonly service: AppWaitlistService) {}

  /**
   * Public endpoint — anyone can subscribe. Returns 200 even if the email
   * is already on the list (idempotent), so the homepage CTA never shows
   * a confusing duplicate-signup error.
   */
  @Post()
  subscribe(@Body() dto: CreateAppWaitlistDto) {
    return this.service.subscribe(dto);
  }
}
