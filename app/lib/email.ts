import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { prisma } from './prisma';
import {
  injectAntiPhishingIntoHtml,
  renderAntiPhishingPlainText,
  resolveAntiPhishingCodeForEmail,
} from './anti-phishing';

function userEmailsEnabled(): boolean {
  const raw = (process.env.USER_EMAILS_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

/**
 * Derives a plain-text version from an HTML string.
 * Strips tags, collapses whitespace, preserves paragraph breaks.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8226;/g, '•')
    .replace(/&middot;/g, '·')
    .replace(/&copy;/g, '©')
    .replace(/&#[0-9]+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Sends a single email using Resend SDK (Primary) or SMTP (Fallback).
 * Always includes a plain-text alternative and List-Unsubscribe for deliverability.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: nodemailer.SendMailOptions['attachments'],
  headers?: Record<string, string>,
  options?: { skipAntiPhishing?: boolean; userId?: string }
) {
  if (!userEmailsEnabled()) {
    console.log(`[Email] User emails disabled — skipped "${subject}" to ${to}`);
    return false;
  }

  let finalHtml = html;
  let plainTextExtra = '';

  if (!options?.skipAntiPhishing) {
    const code = await resolveAntiPhishingCodeForEmail(to, options?.userId);
    if (code) {
      finalHtml = injectAntiPhishingIntoHtml(finalHtml, code);
      plainTextExtra = renderAntiPhishingPlainText(code);
    }
  }

  // 1. Try Resend API first (Bypasses SMTP port blocks)
  const resendApiKey = process.env.RESEND_API_KEY || (await prisma.systemConfig.findUnique({ where: { key: 'RESEND_API_KEY' } }))?.value;

  if (resendApiKey) {
    const resend = new Resend(resendApiKey);

    // Map attachments for Resend if present
    const resendAttachments = attachments?.map(a => ({
      filename: a.filename as string,
      content: a.content as Buffer,
      path: a.path as string,
      contentType: a.contentType as string
    }));

    const resendFrom = process.env.RESEND_FROM || (await prisma.systemConfig.findUnique({ where: { key: 'RESEND_FROM' } }))?.value || 'OpenSteam <support@opensteam.local>';

    // Deliverability headers — reduce spam score
    const deliverabilityHeaders: Record<string, string> = {
      'List-Unsubscribe': '<mailto:unsubscribe@opensteam.local>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Entity-Ref-ID': `gamegen-${Date.now()}`,
      ...headers,
    };

    const { data, error } = await resend.emails.send({
      from: resendFrom,
      to,
      subject,
      html: finalHtml,
      text: htmlToText(finalHtml) + plainTextExtra,
      attachments: resendAttachments,
      headers: deliverabilityHeaders,
    });

    if (!error) return data;
    console.error('[Resend Error]', error);
  }

  // 2. Fallback to SMTP
  try {
    const [host, port, user, pass, from] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_HOST' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_PORT' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_USER' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_PASS' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_FROM' } })
    ]);

    const smtpHost = host?.value || process.env.SMTP_HOST;
    const smtpPort = port?.value || process.env.SMTP_PORT;
    const smtpUser = user?.value || process.env.SMTP_USER;
    const smtpPass = pass?.value || process.env.SMTP_PASS;
    const smtpFrom = from?.value || process.env.SMTP_FROM || '"OpenSteam" <noreply@opensteam.local>';

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn('[Email] Missing Resend API Key and SMTP configuration. Email not sent.');
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '587', 10),
      secure: smtpPort === '465',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html: finalHtml,
      text: htmlToText(finalHtml) + plainTextExtra,
      attachments
    });

    return true;
  } catch (error) {
    console.error('[SMTP Fallback Error]', error);
    return false;
  }
}

/**
 * Sends a batch of emails using Resend SDK (Primary) or SMTP Fallback
 */
export async function sendBatchEmails(batch: Array<{ to: string; subject: string; html: string; userId?: string }>) {
  if (!userEmailsEnabled()) {
    console.log(`[Email] User emails disabled — skipped batch of ${batch.length} message(s)`);
    return false;
  }

  const resendApiKey = process.env.RESEND_API_KEY || (await prisma.systemConfig.findUnique({ where: { key: 'RESEND_API_KEY' } }))?.value;
  
  if (resendApiKey) {
    const resend = new Resend(resendApiKey);
    const resendFrom = process.env.RESEND_FROM || (await prisma.systemConfig.findUnique({ where: { key: 'RESEND_FROM' } }))?.value || 'OpenSteam <support@opensteam.local>';

    const enrichedBatch = await Promise.all(
      batch.map(async (item) => {
        let html = item.html;
        let plainTextExtra = '';
        const code = await resolveAntiPhishingCodeForEmail(item.to, item.userId);
        if (code) {
          html = injectAntiPhishingIntoHtml(html, code);
          plainTextExtra = renderAntiPhishingPlainText(code);
        }
        return {
          from: resendFrom,
          to: item.to,
          subject: item.subject,
          html,
          text: htmlToText(html) + plainTextExtra,
        };
      })
    );
    
    const { data, error } = await resend.batch.send(enrichedBatch);

    if (!error) return true;
    console.error('[Resend Batch Error]', error);
  }

  // Sequential SMTP fallback for batch
  let allSuccess = true;
  for (const item of batch) {
    const success = await sendEmail(item.to, item.subject, item.html, undefined, undefined, { userId: item.userId });
    if (!success) allSuccess = false;
  }
  return allSuccess;
}

export interface BrandedEmailOptions {
  /** CTA button label. Defaults to a label derived from the email type. */
  buttonText?: string
  /** CTA button URL. Defaults to the dashboard. */
  buttonUrl?: string
  /** Badge label above the title. Auto-derived from color if omitted. */
  badge?: string
  /**
   * Optional red warning box shown below the message.
   * Use for security-sensitive emails (login alerts, bans, key deletions).
   */
  securityNotice?: string
  /** When set, resolves the recipient's anti-phishing code without an email lookup. */
  userId?: string
}

/** Auto-derives a badge label from the accent color. */
function badgeFromColor(color: string): string {
  const c = color.toLowerCase()
  if (c === '#dc2626' || c === '#ef4444' || c === '#b91c1c') return 'Security Alert'
  if (c === '#f97316' || c === '#f59e0b' || c === '#ea580c') return 'Account Notice'
  if (c === '#10b981' || c === '#16a34a' || c === '#059669') return 'Confirmed'
  if (c === '#3b82f6' || c === '#2563eb') return 'Plan Update'
  if (c === '#8b5cf6' || c === '#7c3aed') return 'Support'
  return 'Notification'
}

/**
 * Strips leading emoji characters from a title string.
 * Keeps the rest of the text intact so subjects/DM titles are unchanged.
 */
function stripLeadingEmoji(str: string): string {
  return str
    .replace(/^[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{20D0}-\u{20FF}]\s*/u, '')
    .trim()
}

/**
 * Sends a branded, high-fidelity email using the OpenSteam dark template.
 *
 * Backward-compatible signature — all existing calls work unchanged.
 * Pass `options` as the 7th argument to customise the button, badge, or add
 * a security-notice block (red warning box).
 */
export async function sendBrandedEmail(
  to: string,
  subject: string,
  title: string,
  message: string,
  color: string = '#6366f1',
  headers?: Record<string, string>,
  options?: BrandedEmailOptions
): Promise<any> {
  const {
    buttonText = 'Open Dashboard',
    buttonUrl  = 'http://127.0.0.1:3000/dashboard',
    badge      = badgeFromColor(color),
    securityNotice,
    userId,
  } = options ?? {}

  // Render a clean title — strip any leading emoji that callers may pass
  const cleanTitle = stripLeadingEmoji(title)
  const year = new Date().getFullYear()

  // ─── Security notice block (optional) ────────────────────────────────────
  const securityBlock = securityNotice
    ? `
      <tr>
        <td style="padding:0 44px 8px;">
          <table width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.22);border-radius:12px;padding:16px 20px;">
                <p style="margin:0;font-size:13px;line-height:1.65;color:#fca5a5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <strong style="color:#f87171;">&#128274; Security Notice:</strong>&nbsp;${securityNotice}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${title}</title>
  <!--[if !mso]><!-->
  <style>
    @media only screen and (max-width:600px){
      .card-wrap { padding: 24px 12px 48px !important; }
      .card-body { padding: 28px 24px 32px !important; }
      .card-header { padding: 32px 24px 28px !important; }
    }
  </style>
  <!--<![endif]-->
</head>
<body style="margin:0;padding:0;background:#07070b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<!-- Outer wrapper -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#07070b;">
  <tr>
    <td class="card-wrap" align="center" style="padding:48px 20px 64px;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:580px;">

        <!-- ── Logo pill ── -->
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <table border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:100px;padding:7px 20px;">
                  <span style="font-size:10px;font-weight:800;letter-spacing:3px;color:${color};text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">OPENSTEAM</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Card ── -->
        <tr>
          <td style="background:#0d0d11;border:1px solid rgba(255,255,255,0.07);border-radius:24px;overflow:hidden;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">

              <!-- Card header -->
              <tr>
                <td class="card-header" style="background:linear-gradient(150deg,${color}18 0%,transparent 55%);padding:44px 44px 36px;border-bottom:1px solid rgba(255,255,255,0.05);">
                  <!-- Badge -->
                  <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
                    <tr>
                      <td style="background:${color}16;border:1px solid ${color}32;border-radius:8px;padding:5px 13px;">
                        <span style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${color};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${badge}</span>
                      </td>
                    </tr>
                  </table>
                  <!-- Title -->
                  <h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.03em;line-height:1.25;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${cleanTitle}</h1>
                </td>
              </tr>

              <!-- Accent bar -->
              <tr>
                <td style="background:linear-gradient(90deg,${color},${color}00);height:2px;font-size:0;line-height:0;">&nbsp;</td>
              </tr>

              <!-- Message body -->
              <tr>
                <td class="card-body" style="padding:36px 44px 0;">
                  <div style="font-size:15px;line-height:1.8;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    ${message}
                  </div>
                </td>
              </tr>

              <!-- Security notice (conditional) -->
              ${securityBlock}

              <!-- CTA button -->
              <tr>
                <td style="padding:32px 44px 0;text-align:center;">
                  <table border="0" cellpadding="0" cellspacing="0" align="center">
                    <tr>
                      <td style="border-radius:12px;background:${color};">
                        <a href="${buttonUrl}" style="display:inline-block;padding:15px 34px;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${buttonText}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Support hint -->
              <tr>
                <td style="padding:24px 44px 44px;">
                  <p style="margin:0;font-size:12px;color:#334155;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    Questions?&nbsp;<a href="http://127.0.0.1:3000/support" style="color:${color};text-decoration:none;">Open a support ticket</a>&nbsp;or reply to this email.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td align="center" style="padding-top:36px;">
            <table border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:0 14px;">
                  <a href="https://discord.gg/4RdMhcYws" style="color:#374151;text-decoration:none;font-size:12px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Discord</a>
                </td>
                <td style="color:#1f2937;font-size:12px;">&middot;</td>
                <td style="padding:0 14px;">
                  <a href="http://127.0.0.1:3000" style="color:#374151;text-decoration:none;font-size:12px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Website</a>
                </td>
                <td style="color:#1f2937;font-size:12px;">&middot;</td>
                <td style="padding:0 14px;">
                  <a href="http://127.0.0.1:3000/support" style="color:#374151;text-decoration:none;font-size:12px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Support</a>
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0;font-size:11px;color:#1a1f2b;letter-spacing:0.08em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              &copy; ${year} OpenSteam Network &middot; All Rights Reserved
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`

  return sendEmail(to, subject, html, undefined, headers, { userId })
}

/**
 * Sends a premium unified email and Discord DM notifying a user that their plan has been upgraded.
 */
export async function notifyPlanUpgrade(userId: string, newPlan: string, expiry: Date | null) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    const expiryStr = expiry
      ? new Date(expiry).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;

    // 1. Send Discord DM
    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '🌟 Plan Upgraded',
        description: `Your OpenSteam account has been successfully upgraded to the **${newPlan}** plan! Your new features and rate limits are active immediately.${expiryStr ? `\n\n**Valid until:** ${expiryStr}` : ''}`,
        color: 0x3b82f6,
        footer: { text: 'OpenSteam Network' }
      }).catch(() => {});
    }

    // 2. Send Branded Email
    if (user.email) {
      await sendBrandedEmail(
        user.email,
        'Your OpenSteam plan has been upgraded',
        'Plan Upgraded',
        `Hello <strong>${user.username}</strong>,<br><br>Your OpenSteam account has been upgraded to <strong>${newPlan}</strong>. Your premium access and upgraded rate limits are now fully active.${expiryStr ? `<br><br><strong>Access runs until:</strong> ${expiryStr}` : ''}<br><br>Thank you for choosing OpenSteam!`,
        '#3b82f6',
        undefined,
        {
          buttonText: 'Go to Dashboard',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          badge: 'Upgrade Confirmed',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[notifyPlanUpgrade Error]', err);
  }
}

/**
 * Sends a premium unified email and Discord DM notifying a user that their plan has been downgraded.
 */
export async function notifyPlanDowngrade(userId: string, newPlan: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    // 1. Send Discord DM
    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: 'Plan Moved to Free',
        description: `Your account has been moved to the **${newPlan}** plan. Some features may no longer be available.\n\nIf you have questions, please contact support.`,
        color: 0xf97316,
        footer: { text: 'OpenSteam Network' }
      }).catch(() => {});
    }

    // 2. Send Branded Email
    if (user.email) {
      await sendBrandedEmail(
        user.email,
        'Your OpenSteam plan has changed',
        'Plan Changed',
        `Hello <strong>${user.username}</strong>,<br><br>Your account plan has been updated to <strong>${newPlan}</strong>. Features associated with your previous plan are no longer active.<br><br>If you believe this was in error, please contact our support team.`,
        '#f97316',
        undefined,
        {
          buttonText: 'Contact Support',
          buttonUrl: 'http://127.0.0.1:3000/support',
          badge: 'Plan Notice',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[notifyPlanDowngrade Error]', err);
  }
}

/**
 * Sends a gorgeous welcome email and Discord DM to new registered users.
 */
export async function sendWelcomeEmail(userId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    // 1. Send Discord DM welcome
    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '👋 Welcome to OpenSteam!',
        description: `Thanks for joining us, **${user.username}**!\n\nWe're thrilled to have you here. Your account is now fully active. Check out your dashboard to generate your first API key, explore docs, and start generating your Steam manifest files!`,
        color: 0x3b82f6,
        footer: { text: 'OpenSteam Team' }
      }).catch(() => {});
    }

    // 2. Send welcome email
    if (user.email) {
      await sendBrandedEmail(
        user.email,
        'Welcome to OpenSteam! Let\'s get started',
        'Welcome to OpenSteam!',
        `Hello <strong>${user.username}</strong>,<br><br>`
          + `We are absolutely thrilled to welcome you to the OpenSteam family!<br><br>`
          + `OpenSteam is the ultimate, high-performance platform for Steam manifest generation. Here is how to get started in 3 simple steps:<br><br>`
          + `1. <strong>Create an API Key:</strong> Go to your dashboard and generate a secure API key.<br>`
          + `2. <strong>Explore the Documentation:</strong> Read the developer docs to see how to integrate our APIs.<br>`
          + `3. <strong>Join the Community:</strong> Jump into our official Discord server to get help and chat with other developers.<br><br>`
          + `We're here to help you build amazing things. If you have any questions, just click the button below to reach our support team.`,
        '#6366f1',
        undefined,
        {
          buttonText: 'Explore Dashboard',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          badge: 'Welcome',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendWelcomeEmail Error]', err);
  }
}

/**
 * Sends a gorgeous email and Discord DM notifying a user of a permanent WEB platform ban.
 */
export async function sendWebBanEmail(userId: string, reason: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '🚨 Web Account Banned',
        description: `Your OpenSteam account has been **permanently banned from the web platform** by an administrator.\n\n**Reason:** ${reason}\n\nAll associated API keys have been suspended.`,
        color: 0xdc2626,
        footer: { text: 'OpenSteam Network Security' }
      }).catch(() => {});
    }

    if (user.email) {
      await sendBrandedEmail(
        user.email,
        '🚫 Web Access Permanently Banned — OpenSteam',
        'Web Platform Ban',
        `Hello <strong>${user.username}</strong>,<br><br>Your OpenSteam account has been <strong>permanently banned from the web platform</strong> by an administrator.<br><br><strong>Reason:</strong> ${reason}<br><br>All associated API keys have been suspended and web access disabled immediately.`,
        '#dc2626',
        undefined,
        {
          buttonText: 'Submit an Appeal',
          buttonUrl: 'http://127.0.0.1:3000/support',
          securityNotice: 'This is a direct administrative enforcement. Web login, manifest downloads, and API key registrations have been permanently revoked.',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendWebBanEmail Error]', err);
  }
}

/**
 * Sends a gorgeous email and Discord DM notifying a user that their WEB platform ban has been lifted.
 */
export async function sendWebUnbanEmail(userId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '🟢 Web Account Unbanned',
        description: 'Your OpenSteam web platform restrictions have been successfully lifted by an administrator. All API access has been restored.',
        color: 0x16a34a,
        footer: { text: 'OpenSteam Network' }
      }).catch(() => {});
    }

    if (user.email) {
      await sendBrandedEmail(
        user.email,
        '🟢 Web Access Restored — OpenSteam',
        'Web Platform Access Restored',
        `Hello <strong>${user.username}</strong>,<br><br>Your OpenSteam web platform restrictions have been successfully lifted by an administrator. All associated API keys have been re-enabled and full access has been restored.`,
        '#16a34a',
        undefined,
        {
          buttonText: 'Go to Dashboard',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          badge: 'Access Restored',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendWebUnbanEmail Error]', err);
  }
}

/**
 * Sends a gorgeous email and Discord DM notifying a user that they were banned from the official Discord server (guild).
 */
export async function sendDiscordBanEmail(userId: string, reason: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '🚨 Discord Server Ban',
        description: `Your OpenSteam web access has been suspended because you were banned from our official Discord server.\n\n**Reason:** ${reason}`,
        color: 0xea580c,
        footer: { text: 'OpenSteam Network Security' }
      }).catch(() => {});
    }

    if (user.email) {
      await sendBrandedEmail(
        user.email,
        '🚨 Account Suspended — Discord Server Ban',
        'Discord Server Ban',
        `Hello <strong>${user.username}</strong>,<br><br>Your OpenSteam web access has been suspended because you were banned from our official Discord server.<br><br><strong>Reason:</strong> ${reason}<br><br>Since platform access is synchronized with your Discord server membership, your API keys and web access have been temporarily disabled.`,
        '#ea580c',
        undefined,
        {
          buttonText: 'Submit an Appeal',
          buttonUrl: 'http://127.0.0.1:3000/support',
          securityNotice: 'Your web access is linked to your Discord membership. If you believe the Discord ban was in error, please contact staff to appeal.',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendDiscordBanEmail Error]', err);
  }
}

/**
 * Sends a gorgeous email and Discord DM notifying a user that they were unbanned from the official Discord server.
 */
export async function sendDiscordUnbanEmail(userId: string, reason: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '🟢 Discord Server Unbanned',
        description: `Welcome back! Your OpenSteam web access and API keys have been fully restored because you were unbanned from our official Discord server.\n\n**Reason:** ${reason}`,
        color: 0x10b981,
        footer: { text: 'OpenSteam Network' }
      }).catch(() => {});
    }

    if (user.email) {
      await sendBrandedEmail(
        user.email,
        '🟢 Account Restored — Discord Server Unban',
        'Discord Server Access Restored',
        `Hello <strong>${user.username}</strong>,<br><br>Welcome back! Your OpenSteam web access and API keys have been fully restored because you were unbanned from our official Discord server.<br><br><strong>Reason:</strong> ${reason}`,
        '#10b981',
        undefined,
        {
          buttonText: 'Go to Dashboard',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          badge: 'Welcome Back',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendDiscordUnbanEmail Error]', err);
  }
}

/**
 * Sends a gorgeous email and Discord DM notifying a user that their account has been temporarily jailed for rate limit velocity violations.
 */
export async function sendRateLimitJailEmail(userId: string, blockedUntil: Date, reason: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, discordId: true, username: true }
    });

    if (!user) return;

    const expiryTime = new Date(blockedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
    const expiryDateStr = new Date(blockedUntil).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

    if (user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '⚠️ Account Access Jailed',
        description: `Our Autonomy Security Engine has temporarily jailed and restricted your API access.\n\n**Reason:** ${reason}\n\n**Access Restored At:** ${expiryDateStr} at ${expiryTime}`,
        color: 0xf59e0b,
        footer: { text: 'OpenSteam Autonomy Engine' }
      }).catch(() => {});
    }

    if (user.email) {
      await sendBrandedEmail(
        user.email,
        '⚠️ Account Temporarily Jailed — OpenSteam Autonomy Engine',
        'Account Access Jailed',
        `Hello <strong>${user.username}</strong>,<br><br>Our Autonomy Security Engine has detected rate limit velocity violations on your account.<br><br><strong>Reason:</strong> ${reason}<br><br>To protect our server infrastructure, your API access has been temporarily jailed and restricted until <strong>${expiryDateStr} at ${expiryTime}</strong>.`,
        '#f59e0b',
        undefined,
        {
          buttonText: 'Check Dashboard',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          securityNotice: 'Please slow down your request rate. Repeated burst rate limit violations will trigger longer suspensions and may lead to automatic permanent bans.',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendRateLimitJailEmail Error]', err);
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderInitialAppAnswersHtml(answersOrdered: Array<{ questionId: string; title: string; value: string }>): string {
  let html = `
    <div style="background:#13131a; border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:24px; margin-top:20px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <h3 style="margin-top:0; margin-bottom:18px; font-size:18px; color:#f1f5f9; font-weight:700; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:10px;">📝 Submitted Answer Sheet</h3>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  `;

  answersOrdered.forEach((ans, index) => {
    html += `
      <tr>
        <td style="padding:16px 0; border-bottom:${index === answersOrdered.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)'};">
          <div style="font-size:12px; font-weight:600; color:#6366f1; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Question ${index + 1}</div>
          <div style="font-size:15px; font-weight:600; color:#e2e8f0; line-height:1.4; margin-bottom:8px;">${escapeHtml(ans.title)}</div>
          <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:12px 16px; font-size:14px; color:#94a3b8; line-height:1.6; white-space:pre-wrap;">${escapeHtml(ans.value || '(No Answer)')}</div>
        </td>
      </tr>
    `;
  });

  html += `
      </table>
    </div>
  `;
  return html;
}

export function renderTrialExamAnswersHtml(questions: any[], answers: Record<string, string>): string {
  let html = `
    <div style="background:#13131a; border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:24px; margin-top:20px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <h3 style="margin-top:0; margin-bottom:18px; font-size:18px; color:#f1f5f9; font-weight:700; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:10px;">📝 Exam Answer Sheet</h3>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  `;

  questions.forEach((q, index) => {
    const val = answers[q.id] || '';
    const isMcqType = q.type === 'mcq';
    let answerDisplay = '';

    if (isMcqType) {
      const selectedLetter = val.trim().toUpperCase();
      const choicesHtml = Object.entries(q.choices || {}).map(([letter, text]) => {
        const isSelected = selectedLetter === letter;
        const color = isSelected ? '#10b981' : '#94a3b8';
        const bg = isSelected ? 'rgba(16, 185, 129, 0.08)' : 'transparent';
        const border = isSelected ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid transparent';
        return `
          <div style="background:${bg}; border:${border}; border-radius:8px; padding:8px 12px; margin-bottom:6px; font-size:14px; color:${color}; font-weight:${isSelected ? '600' : 'normal'};">
            <span style="font-weight:700; margin-right:8px;">${letter}.</span> ${escapeHtml(text as string)}
            ${isSelected ? ' <span style="float:right; font-size:12px;">✔️ Your Selection</span>' : ''}
          </div>
        `;
      }).join('');

      answerDisplay = `
        <div style="margin-top:8px;">
          ${choicesHtml}
        </div>
      `;
    } else {
      answerDisplay = `
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:12px 16px; font-size:14px; color:#94a3b8; line-height:1.6; white-space:pre-wrap; margin-top:8px;">${escapeHtml(val || '(No Answer)')}</div>
      `;
    }

    html += `
      <tr>
        <td style="padding:16px 0; border-bottom:${index === questions.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)'};">
          <div style="font-size:12px; font-weight:600; color:#3b82f6; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Question ${index + 1} (${isMcqType ? 'Multiple Choice' : 'Written Response'})</div>
          <div style="font-size:15px; font-weight:600; color:#e2e8f0; line-height:1.4; margin-bottom:8px;">${escapeHtml(q.prompt)}</div>
          ${answerDisplay}
        </td>
      </tr>
    `;
  });

  html += `
      </table>
    </div>
  `;
  return html;
}

export async function sendSelfSuspensionEmail(userId: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    if (user.notifyDm && user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '⏸️ Account Suspended',
        description: 'You have successfully suspended your OpenSteam account. To reactivate it, simply log back into the web dashboard.',
        color: 0xf59e0b,
        footer: { text: 'OpenSteam Network' }
      }).catch(() => {});
    }

    if (user.notifyEmail && user.email) {
      await sendBrandedEmail(
        user.email,
        '⏸️ Account Suspended — OpenSteam',
        'Account Suspended',
        `Hello <strong>${user.username}</strong>,<br><br>You have successfully suspended your OpenSteam account. While your account is suspended, all associated API keys and web access are temporarily disabled.<br><br>To reactivate your account, simply log back into the OpenSteam dashboard.`,
        '#f59e0b',
        undefined,
        {
          buttonText: 'Log in to Reactivate',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          badge: 'Status Update',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendSelfSuspensionEmail Error]', err);
  }
}

export async function sendSelfReactivationEmail(userId: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    if (user.notifyDm && user.discordId) {
      const { sendBotDM } = await import('./bot-admin');
      await sendBotDM(user.discordId, '', {
        title: '▶️ Account Reactivated',
        description: 'Welcome back! Your OpenSteam account and all associated API keys have been fully reactivated.',
        color: 0x10b981,
        footer: { text: 'OpenSteam Network' }
      }).catch(() => {});
    }

    if (user.notifyEmail && user.email) {
      await sendBrandedEmail(
        user.email,
        '▶️ Account Reactivated — OpenSteam',
        'Account Reactivated',
        `Hello <strong>${user.username}</strong>,<br><br>Welcome back! By logging in, you have successfully reactivated your OpenSteam account. All your API keys and services are now fully operational.`,
        '#10b981',
        undefined,
        {
          buttonText: 'Go to Dashboard',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          badge: 'Welcome Back',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendSelfReactivationEmail Error]', err);
  }
}

export async function sendAccountDeletionAuthCodeEmail(userId: string, code: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    if (user.notifyEmail && user.email) {
      await sendBrandedEmail(
        user.email,
        'Delete Account Authorization Code',
        'Account Deletion Request',
        `Hello <strong>${user.username}</strong>,<br><br>We received a request to permanently delete your OpenSteam account. Please use the authorization code below to confirm this action.<br><br><div style="font-size:24px; font-weight:800; letter-spacing:4px; text-align:center; padding:16px; background:rgba(239,68,68,0.1); color:#ef4444; border-radius:8px;">${code}</div><br><br>This code will expire in 15 minutes.`,
        '#ef4444',
        undefined,
        {
          buttonText: 'Cancel Request',
          buttonUrl: 'http://127.0.0.1:3000/dashboard',
          securityNotice: 'If you did not request to delete your account, please secure your account immediately and ignore this email.',
          userId,
        }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[sendAccountDeletionAuthCodeEmail Error]', err);
  }
}

export async function sendAccountDeletionCompleteEmail(email: string, username: string, dataBuffer: Buffer) {
  try {
    const html = `<!DOCTYPE html>
<html lang="en">
<body style="background:#07070b; color:#f1f5f9; font-family:sans-serif; padding:40px; text-align:center;">
  <h1 style="color:#dc2626;">Account Permanently Deleted</h1>
  <p>Hello <strong>${username}</strong>,</p>
  <p>Your OpenSteam account has been permanently deleted as requested. All your personal data and API keys have been removed from our active systems.</p>
  <p>We have attached an export of your account data as a JSON file to this email for your records.</p>
  <p>We're sorry to see you go!</p>
</body>
</html>`;

    await sendEmail(
      email,
      'Account Deleted & Data Export',
      html,
      [{ filename: 'opensteam-data-export.json', content: dataBuffer }]
    );
  } catch (err) {
    console.error('[sendAccountDeletionCompleteEmail Error]', err);
  }
}

