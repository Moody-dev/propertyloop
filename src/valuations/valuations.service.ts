import { Injectable } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { CreateValuationDto } from './dto/create-valuation.dto';

const SUPPORT_EMAIL = 'support.propertyloop@propertyloop.ng';
const LOGO_URL =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

@Injectable()
export class ValuationsService {
  constructor(private readonly mailService: MailService) {}

  async submit(dto: CreateValuationDto) {
    const safe = (v?: string | number | null) =>
      v === undefined || v === null || v === '' ? '—' : String(v);

    const subject = `New valuation request — ${dto.address.slice(0, 80)}`;

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827;line-height:1.6;">
  <div style="background-color:#f4f4f5;padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr>
        <td style="background-color:#0f1f14;padding:28px 36px;">
          <img src="${LOGO_URL}" alt="PropertyLoop" height="32" style="display:block;height:32px;width:auto;" />
        </td>
      </tr>
      <tr><td style="height:3px;background-color:#2f9e61;line-height:0;font-size:0;">&nbsp;</td></tr>
      <tr>
        <td style="padding:32px 36px 8px;">
          <p style="margin:0 0 6px;font-size:11px;color:#2f9e61;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Free Property Valuation</p>
          <h1 style="margin:0 0 14px;font-size:20px;color:#111827;font-weight:700;">A new request just came in</h1>
          <p style="margin:0 0 22px;font-size:14px;color:#4b5563;">A homeowner submitted the form on the Sell page. Reach out within 24 hours — replying to this email goes directly to them.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 36px;">
          <h2 style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f1f14;letter-spacing:0.3px;text-transform:uppercase;">Property</h2>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:14px;color:#111827;">
            <tr><td style="padding:8px 0;color:#6b7280;width:40%;">Address</td><td style="padding:8px 0;font-weight:600;">${safe(dto.address)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Type</td><td style="padding:8px 0;font-weight:600;">${safe(dto.propertyType)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Bedrooms</td><td style="padding:8px 0;font-weight:600;">${safe(dto.beds)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Bathrooms</td><td style="padding:8px 0;font-weight:600;">${safe(dto.baths)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Owner estimate</td><td style="padding:8px 0;font-weight:600;">${safe(dto.estimatedValue)}</td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 36px 0;">
          <h2 style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f1f14;letter-spacing:0.3px;text-transform:uppercase;">Contact</h2>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:14px;color:#111827;">
            <tr><td style="padding:8px 0;color:#6b7280;width:40%;">Name</td><td style="padding:8px 0;font-weight:600;">${safe(dto.fullName)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Phone</td><td style="padding:8px 0;font-weight:600;"><a href="tel:${safe(dto.phone)}" style="color:#2f9e61;text-decoration:none;">${safe(dto.phone)}</a></td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;font-weight:600;"><a href="mailto:${safe(dto.email)}" style="color:#2f9e61;text-decoration:none;">${safe(dto.email)}</a></td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 36px 32px;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Submitted ${new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} from the PropertyLoop Sell page.</p>
        </td>
      </tr>
    </table>
  </div>
</body></html>`;

    const text = [
      `New PropertyLoop valuation request`,
      ``,
      `Property:`,
      `  Address       : ${safe(dto.address)}`,
      `  Type          : ${safe(dto.propertyType)}`,
      `  Bedrooms      : ${safe(dto.beds)}`,
      `  Bathrooms     : ${safe(dto.baths)}`,
      `  Owner estimate: ${safe(dto.estimatedValue)}`,
      ``,
      `Contact:`,
      `  Name : ${safe(dto.fullName)}`,
      `  Phone: ${safe(dto.phone)}`,
      `  Email: ${safe(dto.email)}`,
      ``,
      `Reply to this email to write the homeowner directly.`,
    ].join('\n');

    await this.mailService.sendEmail({
      to: SUPPORT_EMAIL,
      subject,
      html,
      text,
      replyTo: dto.email,
    });

    return { success: true };
  }
}
