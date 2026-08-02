import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { generateReceiptPdf } from '../app/lib/receipt';
import { sendEmail, sendBrandedEmail } from '../app/lib/email';
import { sendBotDM } from '../app/lib/bot-admin';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const discordId = args[0]?.trim();
  const overrideEmail = args[1]?.trim();

  if (!discordId) {
    console.log('\n======================================================');
    console.log('  OpenSteam Receipt Generator - "All Accounts" ($100)');
    console.log('======================================================\n');
    console.log('Usage:');
    console.log('  npx tsx scripts/create-all-accounts-receipt.ts <discord_id_or_user_id> [override_email]\n');
    console.log('Examples:');
    console.log('  npx tsx scripts/create-all-accounts-receipt.ts 1205897412502224947');
    console.log('  npx tsx scripts/create-all-accounts-receipt.ts 1205897412502224947 user@example.com\n');
    process.exit(1);
  }

  console.log(`[Receipt CLI] Searching database for Discord ID / User ID: ${discordId}...`);

  // Search by discordId or DB userId
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { discordId: discordId },
        { id: discordId },
      ],
    },
  });

  if (!user) {
    console.error(`❌ Error: User with Discord ID / User ID "${discordId}" was not found in the database.`);
    process.exit(1);
  }

  const recipientEmail = overrideEmail || user.email;
  const username = user.username || user.discordId || 'Valued Customer';
  const targetDiscordId = user.discordId || (discordId.match(/^\d+$/) ? discordId : null);

  console.log(`[Receipt CLI] Found user: ${username} (ID: ${user.id})`);
  console.log(`[Receipt CLI] Target Email: ${recipientEmail || 'NONE'}`);
  console.log(`[Receipt CLI] Target Discord ID: ${targetDiscordId || 'NONE'}`);

  if (!recipientEmail) {
    console.error('❌ Error: No email address found for this user in the database.');
    console.error('Please pass an override email address as the second argument:');
    console.error(`  npx tsx scripts/create-all-accounts-receipt.ts ${discordId} recipient@example.com`);
    process.exit(1);
  }

  // 1. Generate PDF Receipt
  const productName = 'All Accounts';
  const priceDisplay = '$100.00';
  const issueDate = new Date();

  console.log(`[Receipt CLI] Generating official PDF receipt for "${productName}" (${priceDisplay})...`);
  const pdfBuffer = await generateReceiptPdf(username, 'ALL_ACCOUNTS', issueDate, null);

  // Save copy to disk
  const outDir = path.join(process.cwd(), 'backups', 'receipts');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const pdfFilename = `Receipt_All_Accounts_${user.discordId || user.id}_${Date.now()}.pdf`;
  const pdfPath = path.join(outDir, pdfFilename);
  fs.writeFileSync(pdfPath, pdfBuffer);
  console.log(`[Receipt CLI] Saved local PDF receipt to: ${pdfPath}`);

  // 2. Send Branded Confirmation Email + PDF Attachment Email (matching simulate-plan-purchase.ts)
  const purchaseDateStr = issueDate.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const bodyHtml =
    `Thank you for your purchase. Your <strong>${productName}</strong> package is now active.<br><br>` +
    `<strong>Item:</strong> ${productName}<br>` +
    `<strong>Amount Paid:</strong> ${priceDisplay}<br>` +
    `<strong>Purchased:</strong> ${purchaseDateStr}<br><br>` +
    `Your official PDF payment receipt is attached to this email.`;

  console.log(`[Receipt CLI] Delivering branded confirmation email to: ${recipientEmail}...`);

  await sendBrandedEmail(
    recipientEmail,
    `OpenSteam ${productName} — Payment Confirmed`,
    'Payment Confirmed',
    bodyHtml,
    '#10b981',
    undefined,
    {
      buttonText: 'Go to Dashboard',
      buttonUrl: 'http://127.0.0.1:3000/dashboard',
      badge: 'Payment Received',
      userId: user.id,
    }
  ).catch((err) => console.error('[Receipt CLI] Branded email failed:', err));

  const attachments = [
    {
      filename: `Receipt_All_Accounts_${Date.now()}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    },
  ];

  const emailResult = await sendEmail(
    recipientEmail,
    `Receipt — OpenSteam ${productName} (${priceDisplay})`,
    `<p style="font-family:sans-serif;color:#94a3b8;font-size:14px;">Hi ${username}, your official receipt for the ${productName} package (${priceDisplay}) is attached to this email.</p>`,
    attachments,
    undefined,
    { userId: user.id }
  );

  if (emailResult) {
    console.log(`✅ [Receipt CLI] Receipt email sent successfully to ${recipientEmail}!`);
  } else {
    console.warn(`⚠️ [Receipt CLI] Email sending returned false. Check SMTP / Resend API configuration.`);
  }

  // 3. Optional Discord DM Notification
  if (targetDiscordId) {
    try {
      console.log(`[Receipt CLI] Sending Discord DM notification to ${targetDiscordId}...`);
      await sendBotDM(targetDiscordId, '', {
        title: '🧾 Receipt Issued — All Accounts',
        description: `Hello **${username}**, your purchase of **All Accounts** ($100.00) has been completed!\n\nWe have sent your official PDF receipt to **${recipientEmail}**. Thank you for choosing OpenSteam!`,
        color: 0x10b981,
        footer: { text: 'OpenSteam Network Billing' },
      });
      console.log(`✅ [Receipt CLI] Discord DM sent successfully to ${targetDiscordId}!`);
    } catch (dmErr: any) {
      console.warn(`[Receipt CLI] Could not send Discord DM: ${dmErr?.message || dmErr}`);
    }
  }

  console.log('\n======================================================');
  console.log('  SUCCESS: "All Accounts" ($100) receipt process complete!');
  console.log(`  Recipient: ${username} (${recipientEmail})`);
  console.log(`  Local PDF: ${pdfPath}`);
  console.log('======================================================\n');
}

main()
  .catch((err) => {
    console.error('CRITICAL ERROR in receipt script:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
