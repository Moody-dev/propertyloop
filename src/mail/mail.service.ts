import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { SendEmailDto } from './dto/send-email.dto';

@Injectable()
export class MailService {
  private resend: Resend;
  private from: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('MAIL_FROM');

    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not defined');
    }

    if (!from) {
      throw new Error('MAIL_FROM is not defined');
    }

    this.resend = new Resend(apiKey);
    this.from = from;
  }

  async sendEmail(sendEmailDto: SendEmailDto) {
    const { to, subject, html, text, replyTo } = sendEmailDto;

    try {
      const response = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html: html || `<p>${text}</p>`,
        text,
        ...(replyTo ? { replyTo } : {}),
      });

      return response;
    } catch (error) {
      console.error('Email sending failed:', error);
      throw error;
    }
  }
}
