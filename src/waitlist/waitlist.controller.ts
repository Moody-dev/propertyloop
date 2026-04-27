import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Response,
  UseGuards,
  Query,
} from '@nestjs/common';
import { Response as ExpressResponse } from 'express';
import { WaitlistService } from './waitlist.service';
import { MailService } from '../mail/mail.service';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { UpdateWaitlistDto } from './dto/update-waitlist.dto';
import { SendEmailDto } from '../mail/dto/send-email.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('waitlist')
export class WaitlistController {
  constructor(
    private readonly waitlistService: WaitlistService,
    private readonly mailService: MailService,
  ) {}

  @Post()
  create(@Body() createWaitlistDto: CreateWaitlistDto) {
    return this.waitlistService.create(createWaitlistDto);
  }

  @Get()
  findAll() {
    return this.waitlistService.findAll();
  }

  @Get('export')
  async export(@Response() res: ExpressResponse) {
    const csv = await this.waitlistService.export();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="waitlist.csv"');
    res.send(csv);
  }

  @Get('prefill')
  prefill(@Query('token') token: string) {
    return this.waitlistService.prefillFromToken(token);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.waitlistService.activate(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Post(':id/send-email')
  async sendEmail(@Param('id') id: string, @Body() emailDto: SendEmailDto) {
    await this.mailService.sendEmail(emailDto);
    return { success: true, message: 'Email sent successfully' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.waitlistService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWaitlistDto: UpdateWaitlistDto,
  ) {
    return this.waitlistService.update(id, updateWaitlistDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.waitlistService.remove(id);
  }
}
