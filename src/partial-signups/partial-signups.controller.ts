import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PartialSignupsService } from './partial-signups.service';
import { CreatePartialSignupDto } from './dto/create-partial-signup.dto';

@Controller('partial-signups')
export class PartialSignupsController {
  constructor(private readonly service: PartialSignupsService) {}

  /**
   * Public — fired from the signup form as soon as a valid email is entered,
   * before any account exists.
   *
   * Always 204, whatever happened: an empty response can't be used to probe
   * which addresses are already registered, and the form has nothing to show
   * the user for a background capture anyway.
   *
   * Tighter than the global 30/min because a blur handler on a form field is
   * far easier to hammer than a normal endpoint.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(204)
  async capture(@Body() dto: CreatePartialSignupDto): Promise<void> {
    await this.service.capture(dto);
  }
}
