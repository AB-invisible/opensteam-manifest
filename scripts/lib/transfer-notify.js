/**
 * Email + Discord DM notifications after account transfer.
 */

const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const {
  resolveAntiPhishingCodeForEmail,
  injectAntiPhishingIntoHtml,
  renderAntiPhishingPlainText,
  enrichDiscordDmPayload,
} = require('./anti-phishing');

async function getConfigValue(prisma, key) {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value || process.env[key] || null;
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendEmail(prisma, to, subject, html, userId) {
  let finalHtml = html;
  let plainTextExtra = '';
  const code = await resolveAntiPhishingCodeForEmail(prisma, to, userId);
  if (code) {
    finalHtml = injectAntiPhishingIntoHtml(finalHtml, code);
    plainTextExtra = renderAntiPhishingPlainText(code);
  }

  const resendApiKey = await getConfigValue(prisma, 'RESEND_API_KEY');
  const resendFrom =
    (await getConfigValue(prisma, 'RESEND_FROM')) || 'OpenSteam <support@opensteam.local>';

  if (resendApiKey) {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({
      from: resendFrom,
      to,
      subject,
      html: finalHtml,
      text: htmlToText(finalHtml) + plainTextExtra,
    });
    if (!error) return { ok: true, provider: 'resend' };
    console.warn('[Transfer Notify] Resend error:', error);
  }

  const [host, port, user, pass, from] = await Promise.all([
    getConfigValue(prisma, 'SMTP_HOST'),
    getConfigValue(prisma, 'SMTP_PORT'),
    getConfigValue(prisma, 'SMTP_USER'),
    getConfigValue(prisma, 'SMTP_PASS'),
    getConfigValue(prisma, 'SMTP_FROM'),
  ]);

  if (!host || !user || !pass) {
    return { ok: false, error: 'No email provider configured (Resend or SMTP)' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port || '587', 10),
    secure: port === '465',
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: from || resendFrom,
    to,
    subject,
    html: finalHtml,
    text: htmlToText(finalHtml) + plainTextExtra,
  });

  return { ok: true, provider: 'smtp' };
}

async function sendBotDM(prisma, discordId, message, embed, userId) {
  const token = await getConfigValue(prisma, 'DISCORD_BOT_TOKEN');
  if (!token) return { ok: false, error: 'DISCORD_BOT_TOKEN not configured' };

  const payload = await enrichDiscordDmPayload(
    prisma,
    discordId,
    { content: message, embeds: embed ? [embed] : [] },
    userId
  );

  const channelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: discordId }),
  });

  const channel = await channelRes.json();
  if (!channelRes.ok || !channel?.id) {
    return { ok: false, error: `Open DM channel failed: ${channelRes.status}` };
  }

  const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!msgRes.ok) {
    const err = await msgRes.json().catch(() => ({}));
    return { ok: false, error: `Send DM failed: ${msgRes.status} ${JSON.stringify(err)}` };
  }

  return { ok: true };
}

function buildTransferEmailHtml(username, plan, role, coins) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #333;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#1a1a1a;padding:28px;text-align:center;border-bottom:1px solid #333;">
          <h1 style="margin:0;color:#fff;font-size:22px;letter-spacing:2px;text-transform:uppercase;">OpenSteam</h1>
        </td></tr>
        <tr><td style="padding:36px 32px;">
          <h2 style="margin:0 0 16px;color:#a5b4fc;font-size:20px;">Account Transfer Complete</h2>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#d4d4d4;">Hello <strong>${username}</strong>,</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#d4d4d4;">
            Your OpenSteam account has been successfully transferred to your new Discord account.
            All subscription data, usage history, warnings, API keys, and related records are now linked to this account.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#111;border:1px solid #333;border-radius:8px;">
            <tr><td style="padding:16px 20px;font-size:14px;color:#a3a3a3;">
              <strong style="color:#fff;">Plan:</strong> ${plan}<br>
              <strong style="color:#fff;">Role:</strong> ${role}<br>
              <strong style="color:#fff;">Coins:</strong> ${coins}
            </td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#737373;">
            Log in with your new Discord account at the dashboard. If anything looks missing, contact support.
          </p>
          <a href="http://127.0.0.1:3000/dashboard" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Open Dashboard</a>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #333;text-align:center;font-size:12px;color:#525252;">
          &copy; ${year} OpenSteam. All rights reserved.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Notify user on new Discord account after transfer.
 */
async function notifyTransferComplete(prisma, user, oldDiscordId) {
  const results = { email: null, dm: null };

  const embed = {
    title: 'Account Transfer Complete',
    description: [
      `Your OpenSteam account has been transferred to this Discord account.`,
      '',
      `**Plan:** ${user.plan}`,
      `**Role:** ${user.role}`,
      `**Coins:** ${user.coins}`,
      '',
      `Previous Discord ID: \`${oldDiscordId}\``,
      '',
      'Log in at http://127.0.0.1:3000/dashboard with this Discord account.',
    ].join('\n'),
    color: 0x6366f1,
    footer: { text: 'OpenSteam Account Services' },
    timestamp: new Date().toISOString(),
  };

  results.dm = await sendBotDM(prisma, user.discordId, '', embed, user.id);

  if (user.email) {
    const html = buildTransferEmailHtml(user.username, user.plan, user.role, user.coins);
    try {
      results.email = await sendEmail(
        prisma,
        user.email,
        'OpenSteam — Account Transfer Complete',
        html,
        user.id
      );
    } catch (err) {
      results.email = { ok: false, error: err.message };
    }
  } else {
    results.email = { ok: false, error: 'No email on file for new account' };
  }

  return results;
}

module.exports = { notifyTransferComplete };
