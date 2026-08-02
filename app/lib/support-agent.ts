/**
 * OpenSteam AI Support Agent
 */

import { prisma } from './prisma'
import { sendBrandedEmail, sendEmail } from './email'
import { callLlmWithFallback } from './llm-client'

interface UserContext {
  username:    string
  plan:        string
  role:        string
  isBanned:    boolean
  jailUntil:   Date | null
  apiKeyCount: number
  planExpiry:  Date | null
  email:       string
}

export interface AgentResult {
  reply:    string
  resolved: boolean
  category: string
  action?:  'NONE' | 'DELETE_ACCOUNT' | 'EXTRACT_DATA'
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#[0-9]+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}



async function buildDataExport(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      apiKeys: { select: { id: true, name: true, createdAt: true, lastUsed: true, enabled: true } },
      manifests: { select: { steamAppId: true, name: true, downloads: true, createdAt: true } },
      auditLogs: { select: { action: true, details: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 200 },
      supportTickets: { select: { ticketNumber: true, subject: true, message: true, status: true, createdAt: true } },
      webGenerations: { select: { appId: true, gameName: true, source: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 500 }
    }
  });
  if (!user) return null;
  const { webhookSecret, fingerprint, lastUserAgent, ...safeUser } = user as any;
  return { exportedAt: new Date().toISOString(), account: safeUser };
}

async function sendDataExportEmail(user: { email: string | null; username: string }, exportJson: object) {
  if (!user.email) return;
  const json = JSON.stringify(exportJson, null, 2);
  const buffer = Buffer.from(json, 'utf8');
  await sendEmail(
    user.email,
    'Your OpenSteam data export',
    `<p style="font-family:sans-serif;font-size:14px;color:#94a3b8;">Hi ${user.username}, your OpenSteam account data export is attached. This file contains all data we hold about your account.</p>`,
    [
      {
        filename: `opensteam-data-export-${Date.now()}.json`,
        content: buffer,
        contentType: 'application/json'
      }
    ]
  );
}

async function fetchUserContext(email: string): Promise<UserContext | null> {
  const user = await prisma.user.findFirst({
    where: { email },
    include: { _count: { select: { apiKeys: true } } }
  })
  if (!user) return null
  return {
    username:    user.username,
    plan:        user.plan,
    role:        user.role,
    isBanned:    (user as any).isBanned ?? false,
    jailUntil:   user.jailUntil ?? null,
    apiKeyCount: (user as any)._count?.apiKeys ?? 0,
    planExpiry:  user.planExpiry ?? null,
    email:       user.email ?? email,
  }
}



function buildSystemPrompt(ctx: UserContext | null): string {
  const now = new Date()

  const accountBlock = ctx
    ? [
        'VERIFIED ACCOUNT CONTEXT:',
        `  Username:        ${ctx.username}`,
        `  Email:           ${ctx.email}`,
        `  Plan:            ${ctx.plan}`,
        `  Role:            ${ctx.role}`,
        `  API keys:        ${ctx.apiKeyCount}`,
        `  Banned:          ${ctx.isBanned}`,
        `  Suspended until: ${ctx.jailUntil ? ctx.jailUntil.toISOString() : 'N/A'}`,
        `  Plan expiry:     ${ctx.planExpiry ? ctx.planExpiry.toLocaleDateString('en-GB') : 'No expiry'}`,
        `  Current time:    ${now.toISOString()}`,
      ].join('\n')
    : 'ACCOUNT CONTEXT: No OpenSteam account linked to this email.'

  return [
    'You are the OpenSteam support agent. OpenSteam provides Steam game manifests and API access for developers and resellers.',
    '',
    accountBlock,
    '',
    'PLATFORM KNOWLEDGE:',
    'Plans (ascending): FREE -> REGULAR -> PREMIUM -> RESELLER -> BUSINESS -> CUSTOM',
    '- FREE: limited daily generations, no API key',
    '- REGULAR/PREMIUM: personal use, daily gen limits',
    '- RESELLER/BUSINESS: higher limits, commercial use',
    '- CUSTOM: admin-configured limits',
    '',
    'Issues you CAN resolve yourself:',
    '- Unauthorized / 401: API key inactive. Check Dashboard > API Keys.',
    '- Rate limit / 429: explain plan limit, advise upgrade or wait for reset.',
    '- Key not working: advise regenerating key from dashboard or check if disabled.',
    '- Onboarding: sign in via Discord at opensteam.lol, use /gen or API.',
    '- API usage: GET /api/download/{appId}?key=YOUR_KEY',
    '- What plan: explain tiers, REGULAR or PREMIUM for personal use.',
    '- Cannot log in: Discord OAuth only.',
    '- Where is my key: Dashboard > API Keys tab.',
    '- Game not found: use /request on Discord or verify game is on Steam.',
    '- Cancel/pause: plans do not auto-renew unless purchased through Pandabase.',
    '- Data deletion requests if the user explicitly confirms consent (set action to DELETE_ACCOUNT).',
    '- Data extraction requests without deletion (set action to EXTRACT_DATA).',
    '',
    'Issues requiring a HUMAN (always set resolved=false):',
    '- Account bans or suspensions',
    '- Billing disputes or payment issues',
    '- Plan changes needing manual admin action',
    '- GDPR requests without explicit deletion consent',
    '- Suspected account compromise',
    '- Server-side bugs',
    '- Issues involving another users account',
    '',
    'TICKET CATEGORIES (pick one): api, billing, account, ban_appeal, onboarding, technical, general',
    '',
    'OUTPUT: respond with valid JSON only, no markdown fences, no extra text:',
    '{ "category": "...", "resolved": true/false, "reply": "...", "action": "NONE" | "DELETE_ACCOUNT" | "EXTRACT_DATA" }',
    '',
    'REPLY RULES:',
    '- Professional, direct, no filler phrases like Certainly or Great question.',
    '- Use the account data above to personalise the reply.',
    '- If resolved=true this is the final agent reply; ticket will be auto-closed.',
    '- If resolved=false end with: A member of our team will follow up shortly.',
    '- Do NOT include a greeting or sign-off (the email template adds both).',
    '- Maximum 220 words.',
  ].join('\n')
}

function parseAgentOutput(raw: string): AgentResult | null {
  try {
    const clean = raw.replace(/```(?:json)?/gi, '').trim()
    const obj = JSON.parse(clean)
    if (typeof obj.reply !== 'string' || typeof obj.resolved !== 'boolean') return null
    return {
      reply:    obj.reply.trim(),
      resolved: obj.resolved,
      category: typeof obj.category === 'string' ? obj.category : 'general',
      action:   (obj.action === 'DELETE_ACCOUNT' || obj.action === 'EXTRACT_DATA') ? obj.action : 'NONE',
    }
  } catch {
    const trimmed = raw.trim()
    if (!trimmed) return null
    return { reply: trimmed, resolved: false, category: 'general', action: 'NONE' }
  }
}

async function processDeletionRequest(fromEmail: string): Promise<AgentResult | null> {
  const user = await prisma.user.findFirst({
    where: { email: fromEmail },
    select: { id: true, email: true, username: true }
  });

  if (!user) {
    return {
      reply: 'We could not identify a OpenSteam account for this email address. Please log in and request data deletion from your dashboard.',
      resolved: false,
      category: 'account'
    };
  }

  const exportData = await buildDataExport(user.id);
  if (exportData) {
    await sendDataExportEmail(user, exportData).catch(() => {});
  }

  await prisma.user.delete({ where: { id: user.id } });

  return {
    reply: 'Your OpenSteam account and all associated data have been permanently deleted. A data export has been sent to your email address.',
    resolved: true,
    category: 'account'
  };
}

async function processExtractionRequest(fromEmail: string): Promise<AgentResult | null> {
  const user = await prisma.user.findFirst({
    where: { email: fromEmail },
    select: { id: true, email: true, username: true }
  });

  if (!user) {
    return {
      reply: 'We could not identify a OpenSteam account for this email address. Please log in and request a data export from your dashboard.',
      resolved: false,
      category: 'account'
    };
  }

  const exportData = await buildDataExport(user.id);
  if (exportData) {
    await sendDataExportEmail(user, exportData).catch(() => {});
  }

  return {
    reply: 'Your OpenSteam data export has been compiled and emailed to you as an attachment.',
    resolved: true,
    category: 'account'
  };
}

export async function runSupportAgent(
  ticketId:  string,
  fromEmail: string,
  subject:   string,
  message:   string,
): Promise<AgentResult | null> {
  const dummy = null; // Removing unused variable block



  try {
    const ctx = await fetchUserContext(fromEmail)
    const systemPrompt = buildSystemPrompt(ctx)

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: `Subject: "${subject}"\n\nMessage:\n${message}` },
    ]

    const resultRaw = await callLlmWithFallback({ messages, temperature: 0.3, max_tokens: 900 })
    const raw = resultRaw?.message?.content
    if (!raw) return null

    const result = parseAgentOutput(raw)
    if (!result) return null

    if (result.action === 'DELETE_ACCOUNT') {
      const delResult = await processDeletionRequest(fromEmail);
      if (delResult) return delResult;
    } else if (result.action === 'EXTRACT_DATA') {
      const extResult = await processExtractionRequest(fromEmail);
      if (extResult) return extResult;
    }

    await (prisma.supportTicket as any).update({
      where: { id: ticketId },
      data: {
        aiReply:     result.reply,
        aiRepliedAt: new Date(),
        ...(result.resolved ? { status: 'CLOSED' } : {}),
      },
    })

    return result
  } catch (err) {
    console.error('[SupportAgent] Error:', err)
    return null
  }
}
