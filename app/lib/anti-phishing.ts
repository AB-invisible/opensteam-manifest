import crypto from 'crypto';
import { normalizeDiscordSnowflake } from '@/app/lib/discord-id';
import { prisma } from '@/app/lib/prisma';

const CODE_PREFIX = 'GG';
const ANTI_PHISHING_MARKER = 'Anti-Phishing Code';

export function generateAntiPhishingCode(): string {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${CODE_PREFIX}-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}`;
}

export async function ensureUserAntiPhishingCode(userId: string): Promise<string> {
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
      return updated.antiPhishingCode!;
    } catch (error: unknown) {
      const isUniqueViolation =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002';
      if (!isUniqueViolation) throw error;
    }
  }

  throw new Error('Failed to generate unique anti-phishing code');
}

export async function regenerateUserAntiPhishingCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAntiPhishingCode();
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { antiPhishingCode: code },
        select: { antiPhishingCode: true },
      });
      return updated.antiPhishingCode!;
    } catch (error: unknown) {
      const isUniqueViolation =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002';
      if (!isUniqueViolation) throw error;
    }
  }

  throw new Error('Failed to regenerate unique anti-phishing code');
}

export async function resolveAntiPhishingCodeForDiscord(
  discordId: string,
  userId?: string
): Promise<string | null> {
  const normalized = normalizeDiscordSnowflake(discordId) || String(discordId || '').trim();
  if (!normalized || ['unknown', '', 'n/a', '0'].includes(normalized.toLowerCase())) {
    return null;
  }

  if (userId) {
    return ensureUserAntiPhishingCode(userId);
  }

  const user = await prisma.user.findFirst({
    where: { discordId: normalized },
    select: { id: true },
  });

  if (!user) return null;
  return ensureUserAntiPhishingCode(user.id);
}

export async function resolveAntiPhishingCodeForEmail(
  to: string,
  userId?: string
): Promise<string | null> {
  if (userId) {
    return ensureUserAntiPhishingCode(userId);
  }

  const normalized = to.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;

  const user = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    select: { id: true },
  });

  if (!user) return null;
  return ensureUserAntiPhishingCode(user.id);
}

export function renderAntiPhishingEmailBlock(code: string): string {
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

type DiscordDmPayload = {
  content?: string;
  embeds?: unknown[];
  files?: unknown[];
  [key: string]: unknown;
};

export function appendAntiPhishingToDiscordPayload(
  payload: DiscordDmPayload,
  code: string
): DiscordDmPayload {
  const field = {
    name: '🔒 Anti-Phishing Code',
    value: `\`${code}\`\nLegitimate OpenSteam emails and Discord DMs include this personal code.`,
    inline: false,
  };

  if (payload.embeds?.length) {
    const embed = { ...(payload.embeds[0] as Record<string, unknown>) };
    const fields = Array.isArray(embed.fields) ? [...embed.fields] : [];
    if (fields.some((f) => f && typeof f === 'object' && 'name' in f && String(f.name).includes(ANTI_PHISHING_MARKER))) {
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

export async function enrichDiscordDmPayload(
  discordId: string,
  payload: DiscordDmPayload,
  userId?: string
): Promise<DiscordDmPayload> {
  const code = await resolveAntiPhishingCodeForDiscord(discordId, userId);
  if (!code) return payload;
  return appendAntiPhishingToDiscordPayload(payload, code);
}

export function injectAntiPhishingIntoHtml(html: string, code: string): string {
  if (html.includes(`${ANTI_PHISHING_MARKER}:`)) return html;
  const block = renderAntiPhishingEmailBlock(code);
  const supportHintMarker = '<!-- Support hint -->';
  if (html.includes(supportHintMarker)) {
    return html.replace(supportHintMarker, `${block}${supportHintMarker}`);
  }
  return html.replace('<!-- ── Footer ── -->', `${block}<!-- ── Footer ── -->`);
}

export function renderAntiPhishingPlainText(code: string): string {
  return `\n\nAnti-Phishing Code: ${code}\nLegitimate OpenSteam emails and Discord DMs always include this personal code.`;
}
