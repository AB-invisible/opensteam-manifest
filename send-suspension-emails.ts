import { PrismaClient } from '@prisma/client'
import { Resend } from 'resend'
import * as dotenv from 'dotenv'

// Load environment variables from .env if present
dotenv.config()

const prisma = new PrismaClient()

// Ensure RESEND_API_KEY is set in your environment
const resend = new Resend(process.env.RESEND_API_KEY)

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY environment variable is missing!')
    process.exit(1)
  }

  console.log('Fetching users with emails...')
  
  const users = await prisma.user.findMany({
    where: {
      email: {
        not: null
      }
    },
    select: {
      username: true,
      email: true
    }
  })

  if (users.length === 0) {
    console.log('No users with emails found.')
    return
  }

  console.log(`Found ${users.length} users. Preparing to send suspension emails...`)

  // Create a nice branded HTML email template matching OpenSteam's style
  const createEmailHtml = (username: string) => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background-color: #000000;
          color: #ffffff;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #0a0a0a;
          border: 1px solid #333333;
          border-radius: 12px;
          overflow: hidden;
        }
        .header {
          background-color: #1a1a1a;
          padding: 30px 20px;
          text-align: center;
          border-bottom: 1px solid #333333;
        }
        .header h1 {
          margin: 0;
          color: #ffffff;
          font-size: 24px;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .content {
          padding: 40px 30px;
        }
        .content p {
          font-size: 16px;
          line-height: 1.6;
          color: #cccccc;
          margin-bottom: 20px;
        }
        .button-container {
          text-align: center;
          margin: 35px 0;
        }
        .button {
          background-color: #6366f1;
          color: #ffffff;
          text-decoration: none;
          padding: 14px 28px;
          border-radius: 8px;
          font-weight: bold;
          font-size: 16px;
          display: inline-block;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .footer {
          background-color: #111111;
          padding: 25px;
          text-align: center;
          border-top: 1px solid #333333;
        }
        .footer p {
          margin: 0;
          color: #666666;
          font-size: 12px;
          line-height: 1.5;
        }
        .highlight {
          color: #6366f1;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>OpenSteam</h1>
        </div>
        <div class="content">
          <p>Hello <span class="highlight">${username}</span>,</p>
          <p>Unfortunately, we had to suspend your API key for maintenance.</p>
          <p>We are currently performing essential infrastructure upgrades to improve system reliability. We apologize for any disruption this may cause to your projects, and we're working hard to restore full access as soon as possible.</p>
          <p>If you have any questions or need immediate assistance regarding your account, please don't hesitate to reach out to our team.</p>
          <div class="button-container">
            <a href="http://127.0.0.1:3000/support" class="button">Contact Support</a>
          </div>
          <p>Thank you for your patience and understanding.</p>
          <p>Best regards,<br>The OpenSteam Team</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} OpenSteam. All rights reserved.</p>
          <p>This is an automated message, please do not reply directly to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `

  let successCount = 0;
  let failCount = 0;

  for (const user of users) {
    if (!user.email) continue;
    
    try {
      const { data, error } = await resend.emails.send({
        from: 'OpenSteam Support <support@opensteam.local>',
        to: user.email,
        subject: 'Important Notice: API Key Maintenance',
        html: createEmailHtml(user.username),
      });

      if (error) {
        console.error(`Failed to send email to ${user.email}:`, error);
        failCount++;
      } else {
        console.log(`Successfully sent email to ${user.email} (ID: ${data?.id})`);
        successCount++;
      }
      
      // Sleep for a short duration to avoid Resend rate limits
      await new Promise(r => setTimeout(r, 100));
      
    } catch (e) {
      console.error(`Exception while sending to ${user.email}:`, e);
      failCount++;
    }
  }

  console.log(`\nFinished sending emails!`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
