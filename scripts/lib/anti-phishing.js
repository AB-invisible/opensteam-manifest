const crypto = require('crypto');

const CODE_PREFIX = 'GG';
const ANTI_PHISHING_MARKER = 'Anti-Phishing Code';

function generateAntiPhishingCode() {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${CODE_PREFIX}-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}`;
}

async function ensureUserAntiPhishingCode(prisma, userId) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { antiPhishingCode: true },
  });

  if (existing?.antiPhishingCode) {
    return existing.antiPhishingCode;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAntiPhishingCode();
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { antiPhishingCode: code },
        select: { antiPhishingCode: true },
      });
      return updated.antiPhishingCode;
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
    }
  }

  throw new Error('Failed to generate unique anti-phishing code');
}

async function regenerateUserAntiPhishingCode(prisma, userId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAntiPhishingCode();
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { antiPhishingCode: code },
        select: { antiPhishingCode: true },
      });
      return updated.antiPhishingCode;
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
    }
  }

  throw new Error('Failed to regenerate unique anti-phishing code');
}

async function resolveAntiPhishingCodeForDiscord(prisma, discordId, userId) {
  const normalized = String(discordId || '').trim();
  if (!normalized || ['unknown', '', 'n/a', '0'].includes(normalized.toLowerCase())) {
    return null;
  }

  if (userId) {
    return ensureUserAntiPhishingCode(prisma, userId);
  }

  const user = await prisma.user.findFirst({
    where: { discordId: normalized },
    select: { id: true },
  });

  if (!user) return null;
  return ensureUserAntiPhishingCode(prisma, user.id);
}

async function resolveAntiPhishingCodeForEmail(prisma, to, userId) {
  if (userId) {
    return ensureUserAntiPhishingCode(prisma, userId);
  }

  const normalized = String(to || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;

  const user = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    select: { id: true },
  });

  if (!user) return null;
  return ensureUserAntiPhishingCode(prisma, user.id);
}

function renderAntiPhishingEmailBlock(code) {
  return `
      <tr>
        <td style="padding:0 44px 8px;">
          <table width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.22);border-radius:12px;padding:16px 20px;">
                <p style="margin:0 0 8px;font-size:13px;line-height:1.65;color:#86efac;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <strong style="color:#34d399;">Anti-Phishing Code:</strong> Legitimate OpenSteam emails and Discord DMs always include your personal code below.
                </p>
                <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:0.12em;color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;text-align:center;">
                  ${code}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

function injectAntiPhishingIntoHtml(html, code) {
  if (html.includes(`${ANTI_PHISHING_MARKER}:`)) return html;
  const block = renderAntiPhishingEmailBlock(code);
  if (html.includes('<!-- Support hint -->')) {
    return html.replace('<!-- Support hint -->', `${block}<!-- Support hint -->`);
  }
  if (html.includes('class="footer"')) {
    return html.replace('<div class="footer">', `${block}<div class="footer">`);
  }
  return html;
}

function renderAntiPhishingPlainText(code) {
  return `\n\nAnti-Phishing Code: ${code}\nLegitimate OpenSteam emails and Discord DMs always include this personal code.`;
}

function appendAntiPhishingToDiscordPayload(payload, code) {
  const field = {
    name: '🔒 Anti-Phishing Code',
    value: `\`${code}\`\nLegitimate OpenSteam emails and Discord DMs include this personal code.`,
    inline: false,
  };

  if (payload.embeds?.length) {
    const embed = { ...payload.embeds[0] };
    const fields = Array.isArray(embed.fields) ? [...embed.fields] : [];
    if (fields.some((f) => f?.name?.includes(ANTI_PHISHING_MARKER))) {
      return payload;
    }
    fields.push(field);
    embed.fields = fields;
    return { ...payload, embeds: [embed, ...payload.embeds.slice(1)] };
  }

  const block = `\n\n**🔒 Anti-Phishing Code:** \`${code}\`\nLegitimate OpenSteam emails and Discord DMs include this personal code.`;
  if (payload.content?.includes(ANTI_PHISHING_MARKER)) return payload;
  return { ...payload, content: `${payload.content || ''}${block}`.trim() };
}

async function enrichDiscordDmPayload(prisma, discordId, payload, userId) {
  const code = await resolveAntiPhishingCodeForDiscord(prisma, discordId, userId);
  if (!code) return payload;
  return appendAntiPhishingToDiscordPayload(payload, code);
}

module.exports = {
  generateAntiPhishingCode,
  ensureUserAntiPhishingCode,
  regenerateUserAntiPhishingCode,
  resolveAntiPhishingCodeForDiscord,
  resolveAntiPhishingCodeForEmail,
  injectAntiPhishingIntoHtml,
  renderAntiPhishingPlainText,
  appendAntiPhishingToDiscordPayload,
  enrichDiscordDmPayload,
};
