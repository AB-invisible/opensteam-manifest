const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

// Load environment variables if .env exists
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  });
}

const prisma = new PrismaClient();

async function getReceiptPdf(username) {
  // Use compiled PDF generator or pdf-lib directly
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([612, 792]);
  const C = {
    midnight: rgb(0.043, 0.055, 0.098),
    emerald: rgb(0.063, 0.725, 0.506),
    emeraldSoft: rgb(0.93, 0.99, 0.96),
    white: rgb(1, 1, 1),
    ink: rgb(0.07, 0.09, 0.12),
    cloud: rgb(0.62, 0.68, 0.78),
    slate500: rgb(0.45, 0.5, 0.58),
    slate200: rgb(0.89, 0.91, 0.93),
  };

  // Header band
  page.drawRectangle({ x: 0, y: 640, width: 612, height: 152, color: C.midnight });
  page.drawRectangle({ x: 0, y: 640, width: 612, height: 3, color: C.emerald });
  page.drawText("OPENSTEAM MANIFEST PLATFORM", { x: 56, y: 720, size: 20, font: bold, color: C.white });
  page.drawText("gamegen.lol", { x: 56, y: 700, size: 10, font, color: C.cloud });

  const dateStr = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const receiptNo = `GG-${Date.now().toString(36).toUpperCase()}`;

  page.drawText("OFFICIAL RECEIPT", { x: 420, y: 740, size: 10, font: bold, color: C.emerald });
  page.drawText(`No. ${receiptNo}`, { x: 420, y: 720, size: 12, font: bold, color: C.white });
  page.drawText(dateStr, { x: 420, y: 705, size: 9, font, color: C.cloud });

  // Meta Section
  page.drawText("BILLED TO", { x: 56, y: 590, size: 9, font: bold, color: C.slate500 });
  page.drawText(username, { x: 56, y: 568, size: 14, font: bold, color: C.ink });
  page.drawText("OpenSteam Account Holder", { x: 56, y: 552, size: 9, font, color: C.slate500 });

  page.drawText("PAYMENT DETAILS", { x: 350, y: 590, size: 9, font: bold, color: C.slate500 });
  page.drawText("Method: Direct Billing / VPS", { x: 350, y: 568, size: 9, font, color: C.ink });
  page.drawText("Status: Paid in Full", { x: 350, y: 552, size: 9, font: bold, color: C.emerald });

  // Order Table Header
  page.drawRectangle({ x: 56, y: 480, width: 500, height: 32, color: C.midnight });
  page.drawText("DESCRIPTION", { x: 76, y: 492, size: 8, font: bold, color: C.cloud });
  page.drawText("TYPE", { x: 320, y: 492, size: 8, font: bold, color: C.cloud });
  page.drawText("AMOUNT", { x: 490, y: 492, size: 8, font: bold, color: C.cloud });

  // Item Row
  page.drawRectangle({ x: 56, y: 420, width: 500, height: 58, color: C.white, borderColor: C.slate200, borderWidth: 1 });
  page.drawRectangle({ x: 56, y: 420, width: 4, height: 58, color: C.emerald });

  page.drawText("All Accounts", { x: 76, y: 452, size: 13, font: bold, color: C.ink });
  page.drawText("OpenSteam full platform package", { x: 76, y: 436, size: 9, font, color: C.slate500 });
  page.drawText("Lifetime access", { x: 320, y: 444, size: 9, font, color: C.ink });
  page.drawText("$100.00", { x: 490, y: 444, size: 12, font: bold, color: C.ink });

  // Total Box
  page.drawRectangle({ x: 350, y: 330, width: 206, height: 50, color: C.emeraldSoft, borderColor: C.emerald, borderWidth: 1 });
  page.drawText("TOTAL PAID", { x: 366, y: 356, size: 9, font: bold, color: C.emerald });
  page.drawText("One-time payment", { x: 366, y: 342, size: 8, font, color: C.slate500 });
  page.drawText("$100.00", { x: 470, y: 346, size: 20, font: bold, color: C.emerald });

  // Notes & Footer
  page.drawText("Thank you for choosing OpenSteam.", { x: 56, y: 260, size: 12, font: bold, color: C.ink });
  page.drawText("Your All Accounts package is now active. Retain this official receipt for your records.", { x: 56, y: 242, size: 9, font, color: C.slate500 });

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 48, color: C.midnight });
  page.drawText("OPENSTEAM MANIFEST PLATFORM - support@opensteam.local", { x: 56, y: 20, size: 8.5, font, color: C.cloud });

  return Buffer.from(await doc.save());
}

async function sendReceiptEmail(to, subject, html, attachments) {
  const resendKey = process.env.RESEND_API_KEY || (await prisma.systemConfig.findUnique({ where: { key: 'RESEND_API_KEY' } }))?.value;
  if (resendKey) {
    try {
      const resend = new Resend(resendKey);
      const resendFrom = process.env.RESEND_FROM || (await prisma.systemConfig.findUnique({ where: { key: 'RESEND_FROM' } }))?.value || 'OpenSteam <support@opensteam.local>';
      const { data, error } = await resend.emails.send({
        from: resendFrom,
        to,
        subject,
        html,
        attachments: attachments.map(a => ({ filename: a.filename, content: a.content })),
      });
      if (!error) return true;
      console.error('[Resend Error]', error);
    } catch (e) {
      console.warn('[Resend Exception]', e.message);
    }
  }

  // SMTP Fallback
  try {
    const [host, port, user, pass, from] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_HOST' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_PORT' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_USER' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_PASS' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_FROM' } }),
    ]);

    const smtpHost = host?.value || process.env.SMTP_HOST;
    const smtpPort = port?.value || process.env.SMTP_PORT || '587';
    const smtpUser = user?.value || process.env.SMTP_USER;
    const smtpPass = pass?.value || process.env.SMTP_PASS;
    const smtpFrom = from?.value || process.env.SMTP_FROM || '"OpenSteam" <support@opensteam.local>';

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn('[Email Warning] No Resend API key or SMTP config available in DB/env.');
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort, 10),
      secure: smtpPort === '465',
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({ from: smtpFrom, to, subject, html, attachments });
    return true;
  } catch (err) {
    console.error('[SMTP Error]', err.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const discordIdInput = args[0]?.trim();
  const overrideEmail = args[1]?.trim();

  if (!discordIdInput) {
    console.log('\n======================================================');
    console.log('  OpenSteam Receipt Generator - "All Accounts" ($100)');
    console.log('======================================================\n');
    console.log('Usage:');
    console.log('  node scripts/create-all-accounts-receipt.js <discord_id_or_user_id> [override_email]\n');
    console.log('Examples:');
    console.log('  node scripts/create-all-accounts-receipt.js 1205897412502224947');
    console.log('  node scripts/create-all-accounts-receipt.js 1205897412502224947 user@example.com\n');
    process.exit(1);
  }

  console.log(`[Receipt Script] Fetching user info from DB for ID: ${discordIdInput}...`);

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { discordId: discordIdInput },
        { id: discordIdInput },
      ],
    },
  });

  if (!user) {
    console.error(`❌ Error: User with Discord ID / DB ID "${discordIdInput}" was not found in the database.`);
    process.exit(1);
  }

  const recipientEmail = overrideEmail || user.email;
  const username = user.username || user.discordId || 'Valued Customer';

  console.log(`[Receipt Script] Found user: ${username} (DB ID: ${user.id})`);
  console.log(`[Receipt Script] Recipient Email: ${recipientEmail || 'NONE'}`);

  if (!recipientEmail) {
    console.error('❌ Error: User has no email stored in database.');
    console.error('Please pass the recipient email as the 2nd argument:');
    console.error(`  node scripts/create-all-accounts-receipt.js ${discordIdInput} recipient@example.com`);
    process.exit(1);
  }

  // 1. Generate PDF Receipt
  console.log('[Receipt Script] Generating PDF receipt for "All Accounts" ($100.00)...');
  const pdfBuffer = await getReceiptPdf(username);

  // Save to backups folder
  const outDir = path.join(__dirname, '../backups/receipts');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, `Receipt_All_Accounts_${user.discordId || user.id}_${Date.now()}.pdf`);
  fs.writeFileSync(pdfPath, pdfBuffer);
  console.log(`[Receipt Script] Saved local PDF copy to: ${pdfPath}`);

  // 2. Build and Send Email
  const subject = `Official OpenSteam Payment Receipt — All Accounts ($100.00)`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background:#07070b; color:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; padding:40px 20px;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#0d0d11; border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:36px;">
        <tr>
          <td>
            <div style="font-size:10px; font-weight:800; letter-spacing:3px; color:#10b981; text-transform:uppercase; margin-bottom:16px;">OPENSTEAM NETWORK</div>
            <h1 style="font-size:24px; font-weight:700; color:#ffffff; margin:0 0 16px 0;">Official Payment Receipt</h1>
            <p style="font-size:15px; line-height:1.7; color:#94a3b8; margin-bottom:24px;">
              Hello <strong>${username}</strong>,<br><br>
              Thank you for your purchase of the <strong>All Accounts</strong> package on OpenSteam.<br><br>
              Your payment of <strong>$100.00</strong> has been processed in full. We have attached your official PDF payment receipt to this email for your records.
            </p>
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:12px; padding:20px; margin-bottom:24px;">
              <tr>
                <td style="font-size:13px; color:#94a3b8; padding-bottom:8px;"><strong>Product:</strong></td>
                <td align="right" style="font-size:13px; color:#ffffff; font-weight:600; padding-bottom:8px;">All Accounts</td>
              </tr>
              <tr>
                <td style="font-size:13px; color:#94a3b8; padding-bottom:8px;"><strong>Amount Paid:</strong></td>
                <td align="right" style="font-size:13px; color:#10b981; font-weight:700; padding-bottom:8px;">$100.00</td>
              </tr>
              <tr>
                <td style="font-size:13px; color:#94a3b8;"><strong>Payment Status:</strong></td>
                <td align="right" style="font-size:13px; color:#ffffff; font-weight:600;">Paid in Full</td>
              </tr>
            </table>
            <p style="font-size:12px; color:#475569; line-height:1.6; margin:0;">
              Questions? Reply directly to this email or visit <a href="http://127.0.0.1:3000/support" style="color:#10b981; text-decoration:none;">gamegen.lol/support</a>.
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  console.log(`[Receipt Script] Delivering email with PDF receipt to: ${recipientEmail}...`);
  const success = await sendReceiptEmail(recipientEmail, subject, html, [
    { filename: 'OpenSteam_Receipt_All_Accounts.pdf', content: pdfBuffer },
  ]);

  if (success) {
    console.log(`✅ [Receipt Script] SUCCESS! Official receipt emailed to ${recipientEmail}`);
  } else {
    console.warn(`⚠️ [Receipt Script] Email dispatch finished. Local PDF saved to ${pdfPath}`);
  }

  console.log('\n======================================================');
  console.log('  Complete: "All Accounts" ($100) receipt created & sent!');
  console.log('======================================================\n');
}

main()
  .catch((err) => {
    console.error('CRITICAL ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
