/**
 * Send Sallah celebration messages to all active users on Propertyloop.
 *
 * Usage:
 *   npx ts-node scripts/send-sallah-celebration.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { Resend } from 'resend';

const BATCH_SIZE = 50; // Send in batches to avoid rate limits
const DELAY_BETWEEN_BATCHES = 1000; // 1 second between batches

async function sendSallahEmails() {
  const databaseUrl = process.env.DATABASE_URL;
  const resendApiKey = process.env.RESEND_API_KEY;
  const mailFrom = process.env.MAIL_FROM;

  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!resendApiKey) throw new Error('RESEND_API_KEY is not set');
  if (!mailFrom) throw new Error('MAIL_FROM is not set');

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter } as any);
  const resend = new Resend(resendApiKey);

  try {
    // Get all active users with verified emails
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        emailVerifiedAt: { not: null },
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`Found ${users.length} active users to notify`);

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

    let successCount = 0;
    let failureCount = 0;
    const failures: Array<{ email: string; error: string }> = [];

    // Send emails in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(users.length / BATCH_SIZE);

      console.log(`\nSending batch ${batchNumber}/${totalBatches} (${batch.length} emails)...`);

      for (const user of batch) {
        try {
          await resend.emails.send({
            from: mailFrom,
            to: user.email,
            subject,
            html: htmlContent,
            text: textContent,
          });

          successCount++;
          console.log(`✓ Sent to ${user.email}`);
        } catch (error) {
          failureCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          failures.push({ email: user.email, error: errorMessage });
          console.error(`✗ Failed to send to ${user.email}: ${errorMessage}`);
        }
      }

      // Wait before next batch (except for the last one)
      if (i + BATCH_SIZE < users.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SALLAH CELEBRATION EMAIL CAMPAIGN SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total users: ${users.length}`);
    console.log(`✓ Successfully sent: ${successCount}`);
    console.log(`✗ Failed: ${failureCount}`);

    if (failures.length > 0) {
      console.log('\nFailed recipients:');
      failures.forEach(({ email, error }) => {
        console.log(`  - ${email}: ${error}`);
      });
    }

    console.log('='.repeat(60) + '\n');

    process.exit(failureCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('Script error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

sendSallahEmails();
