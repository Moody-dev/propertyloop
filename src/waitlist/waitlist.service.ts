import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { UpdateWaitlistDto } from './dto/update-waitlist.dto';

@Injectable()
export class WaitlistService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  private readonly LOGO_URL = 'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

  create(createWaitlistDto: CreateWaitlistDto) {
    return this.sendWelcomeEmail(createWaitlistDto);
  }

  private async sendWelcomeEmail(createWaitlistDto: CreateWaitlistDto) {
    // Check if email already exists
    const existingEntry = await this.prisma.waitlistEntry.findUnique({
      where: { email: createWaitlistDto.email },
    });

    if (existingEntry) {
      throw new ConflictException('This email is already on the waitlist');
    }

    const entry = await this.prisma.waitlistEntry.create({
      data: {
        first_name: createWaitlistDto.first_name,
        last_name: createWaitlistDto.last_name,
        company_name: createWaitlistDto.company_name,
        location: createWaitlistDto.location,
        phone: createWaitlistDto.phone,
        email: createWaitlistDto.email,
        type: createWaitlistDto.type,
      },
    });

    // Send welcome email asynchronously (don't wait for it)
    this.mailService
      .sendEmail({
        to: entry.email,
        subject: 'PropertyLoop',
        text: `Welcome to PropertyLoop! Thank you for joining our waitlist as a ${createWaitlistDto.type.replace(/_/g, ' ')}.`,
        html: this.getWelcomeEmailTemplate(entry.first_name),
      })
      .catch((err) => {
        console.error('Failed to send welcome email:', err);
      });

    return entry;
  }

  private getWelcomeEmailTemplate(firstName: string): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to PropertyLoop</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
              background-color: #f4f4f5;
              color: #111827;
              line-height: 1.6;
              -webkit-font-smoothing: antialiased;
            }
            .wrapper { background-color: #f4f4f5; padding: 40px 16px; }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: #ffffff;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
              overflow: hidden;
            }
            .header {
              background-color: #0f1f14;
              padding: 36px 48px;
              text-align: left;
            }
            .header img { height: 36px; width: auto; display: block; }
            .divider-green {
              height: 3px;
              background-color: #2f9e61;
            }
            .content { padding: 48px; }
            .greeting {
              font-size: 22px;
              font-weight: 600;
              color: #111827;
              margin-bottom: 16px;
              letter-spacing: -0.3px;
            }
            .body-text {
              font-size: 15px;
              color: #4b5563;
              line-height: 1.75;
              margin-bottom: 32px;
            }
            .section-label {
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 1px;
              text-transform: uppercase;
              color: #2f9e61;
              margin-bottom: 16px;
            }
            .feature-list { margin-bottom: 36px; }
            .feature-row {
              display: flex;
              align-items: flex-start;
              padding: 14px 0;
              border-bottom: 1px solid #f3f4f6;
            }
            .feature-row:last-child { border-bottom: none; }
            .feature-dot {
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background-color: #2f9e61;
              margin-top: 8px;
              margin-right: 14px;
              flex-shrink: 0;
            }
            .feature-content { flex: 1; }
            .feature-title {
              font-size: 14px;
              font-weight: 600;
              color: #111827;
              margin-bottom: 2px;
            }
            .feature-desc {
              font-size: 14px;
              color: #6b7280;
              line-height: 1.6;
            }
            .divider {
              border: none;
              border-top: 1px solid #e5e7eb;
              margin: 36px 0;
            }
            .closing { font-size: 15px; color: #4b5563; line-height: 1.75; }
            .signature { margin-top: 28px; }
            .signature-name {
              font-size: 14px;
              font-weight: 600;
              color: #111827;
            }
            .signature-title {
              font-size: 13px;
              color: #9ca3af;
              margin-top: 2px;
            }
            .footer {
              background-color: #f9fafb;
              border-top: 1px solid #e5e7eb;
              padding: 28px 48px;
              text-align: center;
            }
            .footer-logo { margin-bottom: 16px; }
            .footer-logo img { height: 24px; width: auto; opacity: 0.6; }
            .footer-links {
              font-size: 12px;
              color: #9ca3af;
              margin-bottom: 10px;
            }
            .footer-links a {
              color: #6b7280;
              text-decoration: none;
              margin: 0 10px;
            }
            .footer-links a:hover { color: #111827; }
            .footer-copy {
              font-size: 11px;
              color: #d1d5db;
            }
            @media (max-width: 600px) {
              .content { padding: 32px 24px; }
              .header { padding: 28px 24px; }
              .footer { padding: 24px; }
            }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="container">
              <div class="header">
                <img src="${this.LOGO_URL}" alt="PropertyLoop">
              </div>
              <div class="divider-green"></div>

              <div class="content">
                <div class="greeting">Hi ${firstName},</div>

                <p class="body-text">
                  Thank you for joining the PropertyLoop waitlist. You're now part of a growing community of real estate professionals who are shaping the future of property management in Nigeria.
                </p>

                <div class="section-label">What happens next</div>
                <div class="feature-list">
                  <div class="feature-row">
                    <div class="feature-dot"></div>
                    <div class="feature-content">
                      <div class="feature-title">Early Access</div>
                      <div class="feature-desc">You'll be among the first to access the platform when we launch.</div>
                    </div>
                  </div>
                  <div class="feature-row">
                    <div class="feature-dot"></div>
                    <div class="feature-content">
                      <div class="feature-title">Exclusive Updates</div>
                      <div class="feature-desc">We'll keep you informed on development progress and key milestones.</div>
                    </div>
                  </div>
                  <div class="feature-row">
                    <div class="feature-dot"></div>
                    <div class="feature-content">
                      <div class="feature-title">Launch Benefits</div>
                      <div class="feature-desc">Early adopters receive special pricing and perks at launch.</div>
                    </div>
                  </div>
                  <div class="feature-row">
                    <div class="feature-dot"></div>
                    <div class="feature-content">
                      <div class="feature-title">Your Input Matters</div>
                      <div class="feature-desc">We actively incorporate feedback from our waitlist in shaping the product.</div>
                    </div>
                  </div>
                </div>

                <hr class="divider">

                <p class="closing">
                  If you have questions or feedback, feel free to reply directly to this email. We read every message.
                </p>

                <div class="signature">
                  <div class="signature-name">The PropertyLoop Team</div>
                  <div class="signature-title">propertyloop.ng</div>
                </div>
              </div>

              <div class="footer">
                <div class="footer-logo">
                  <img src="${this.LOGO_URL}" alt="PropertyLoop">
                </div>
                <div class="footer-links">
                  <a href="https://propertyloop.ng/privacy">Privacy Policy</a>
                  <a href="https://propertyloop.ng/terms">Terms of Service</a>
                  <a href="https://propertyloop.ng/contact">Contact</a>
                </div>
                <div class="footer-copy">&copy; 2026 PropertyLoop. All rights reserved.</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  findAll() {
    return this.prisma.waitlistEntry.findMany({
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  findOne(id: string) {
    return this.prisma.waitlistEntry.findUnique({
      where: { id },
    });
  }

  update(id: string, updateWaitlistDto: UpdateWaitlistDto) {
    return this.prisma.waitlistEntry.update({
      where: { id },
      data: updateWaitlistDto,
    });
  }

  remove(id: string) {
    return this.prisma.waitlistEntry.delete({
      where: { id },
    });
  }

  async export(): Promise<string> {
    const entries = await this.prisma.waitlistEntry.findMany({
      orderBy: {
        created_at: 'desc',
      },
    });

    if (entries.length === 0) {
      return 'ID,First Name,Last Name,Email,Phone,Company Name,Location,Type,Created At\n';
    }

    const headers = [
      'ID',
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Company Name',
      'Location',
      'Type',
      'Created At',
    ];

    const rows = entries.map((entry) => [
      this.escapeCsvField(entry.id),
      this.escapeCsvField(entry.first_name),
      this.escapeCsvField(entry.last_name),
      this.escapeCsvField(entry.email),
      this.escapeCsvField(entry.phone),
      this.escapeCsvField(entry.company_name || ''),
      this.escapeCsvField(entry.location || ''),
      this.escapeCsvField(entry.type),
      this.escapeCsvField(entry.created_at.toISOString()),
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join(
      '\n',
    );

    return csv;
  }

  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  // Helper method to create branded email templates for other email types
  getEmailTemplate(type: 'welcome' | 'confirmation' | 'update' | 'notification', data: Record<string, any>): string {
    const sharedStyles = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        background-color: #f4f4f5;
        color: #111827;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
      }
      .wrapper { background-color: #f4f4f5; padding: 40px 16px; }
      .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; }
      .header { background-color: #0f1f14; padding: 36px 48px; text-align: left; }
      .header img { height: 36px; width: auto; display: block; }
      .divider-green { height: 3px; background-color: #2f9e61; }
      .content { padding: 48px; }
      .footer { background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 28px 48px; text-align: center; }
      .footer-logo { margin-bottom: 14px; }
      .footer-logo img { height: 24px; width: auto; opacity: 0.6; }
      .footer-links { font-size: 12px; margin-bottom: 10px; }
      .footer-links a { color: #6b7280; text-decoration: none; margin: 0 10px; }
      .footer-copy { font-size: 11px; color: #d1d5db; }
      @media (max-width: 600px) { .content { padding: 32px 24px; } .header { padding: 28px 24px; } .footer { padding: 24px; } }
    `;

    const commonFooter = `
      <div class="footer">
        <div class="footer-logo">
          <img src="${this.LOGO_URL}" alt="PropertyLoop">
        </div>
        <div class="footer-links">
          <a href="https://propertyloop.ng/privacy">Privacy Policy</a>
          <a href="https://propertyloop.ng/terms">Terms of Service</a>
          <a href="https://propertyloop.ng/contact">Contact</a>
        </div>
        <div class="footer-copy">&copy; 2026 PropertyLoop. All rights reserved.</div>
      </div>
    `;

    if (type === 'confirmation') {
      return `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PropertyLoop Confirmation</title>
            <style>${sharedStyles}</style>
          </head>
          <body>
            <div class="wrapper">
              <div class="container">
                <div class="header">
                  <img src="${this.LOGO_URL}" alt="PropertyLoop">
                </div>
                <div class="divider-green"></div>
                <div class="content">
                  <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin-bottom: 16px;">Confirmed</h2>
                  <p style="font-size: 15px; color: #4b5563; line-height: 1.75;">
                    ${data.message || 'Your request has been confirmed. Thank you for joining PropertyLoop!'}
                  </p>
                </div>
                ${commonFooter}
              </div>
            </div>
          </body>
        </html>
      `;
    }

    return '';
  }
}
