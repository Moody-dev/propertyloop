/**
 * Send a demo Sallah celebration email.
 *
 * Usage:
 *   npx ts-node scripts/send-sallah-demo.ts <recipient-email>
 */
import 'dotenv/config';
import { Resend } from 'resend';

async function sendDemoEmail() {
  const [, , recipientEmail] = process.argv;

  if (!recipientEmail) {
    console.error('Usage: npx ts-node scripts/send-sallah-demo.ts <recipient-email>');
    process.exit(1);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const mailFrom = process.env.MAIL_FROM;

  if (!resendApiKey) throw new Error('RESEND_API_KEY is not set');
  if (!mailFrom) throw new Error('MAIL_FROM is not set');

  const resend = new Resend(resendApiKey);

  const subject = '🌙 Eid Mubarak from Propertyloop Real Estate!';
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      font-size: 28px;
    }
    .greeting {
      margin-bottom: 20px;
      font-size: 16px;
    }
    .content {
      margin-bottom: 20px;
      font-size: 15px;
      line-height: 1.8;
    }
    .signature {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 14px;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      font-size: 12px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">🌙 Eid Mubarak from Propertyloop Real Estate!</div>
    
    <div class="greeting">Dear User,</div>
    
    <div class="content">
      <p>As we celebrate this joyful Sallah season, we sincerely appreciate your support, trust, and engagement with the Propertyloop community.</p>
      
      <p>May this festive season bring peace, happiness, prosperity, and new opportunities to you and your loved ones. Thank you for being part of our journey as we continue building a smarter and more connected real estate platform for everyone.</p>
    </div>
    
    <div class="signature">
      <p>Warm regards,</p>
      <p><strong>Propertyloop Real Estate</strong></p>
    </div>
    
    <div class="footer">
      <p>Propertyloop © 2026. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const textContent = `🌙 Eid Mubarak from Propertyloop Real Estate!

As we celebrate this joyful Sallah season, we sincerely appreciate your support, trust, and engagement with the Propertyloop community.

May this festive season bring peace, happiness, prosperity, and new opportunities to you and your loved ones. Thank you for being part of our journey as we continue building a smarter and more connected real estate platform for everyone.

Warm regards,
Propertyloop Real Estate`;

  try {
    console.log(`Sending demo email to ${recipientEmail}...`);
    
    const response = await resend.emails.send({
      from: mailFrom,
      to: recipientEmail,
      subject,
      html: htmlContent,
      text: textContent,
    });

    console.log('✓ Demo email sent successfully!');
    console.log('Response:', response);
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to send demo email:', error);
    process.exit(1);
  }
}

sendDemoEmail();
