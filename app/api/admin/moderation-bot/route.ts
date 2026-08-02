import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/app/lib/prisma';
import { createAuditLog } from '@/app/lib/audit';
import { getClientIp } from '@/app/lib/ip';

import { callLlmWithFallback } from '@/app/lib/llm-client';

export const dynamic = 'force-dynamic';

// Tool definitions for LLM function calling
const tools = [
  {
    type: 'function',
    function: {
      name: 'searchUsers',
      description: 'Search users by username, email, discordId, or id.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'viewUser',
      description: 'Get full user details by CUID or Discord ID.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'CUID or Discord ID' }
        },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'setPlan',
      description: 'Set a user\'s plan.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          plan: { type: 'string', enum: ['FREE', 'REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM'] }
        },
        required: ['userId', 'plan']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'setRole',
      description: 'Set a user\'s role.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          role: { type: 'string', enum: ['USER', 'TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER'] }
        },
        required: ['userId', 'role']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'banUser',
      description: 'Globally ban a user: revokes API keys and blacklists their IP.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['userId', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'unbanUser',
      description: 'Lift a global ban, re-enable API keys, and unblock IP.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' }
        },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'banFromDiscordGuild',
      description: 'Ban a member from the Discord guild via bot API.',
      parameters: {
        type: 'object',
        properties: {
          discordId: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['discordId', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listIpJails',
      description: 'List all active IP/key rate limit jails.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clearIpJail',
      description: 'Clear an active rate limit jail by IP or API key.',
      parameters: {
        type: 'object',
        properties: {
          ipOrKey: { type: 'string' }
        },
        required: ['ipOrKey']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'queryAuditLogs',
      description: 'Query audit logs. All params optional.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'e.g. BAN_USER' },
          targetId: { type: 'string' },
          query: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sendEmail',
      description: 'Send a branded email. senderName: OpenSteam AI|OpenSteam Team|OpenSteam Support. accentColor: hex (#6366f1 default, #ef4444 warn, #10b981 success).',
      parameters: {
        type: 'object',
        properties: {
          toEmail: { type: 'string' },
          subject: { type: 'string' },
          title: { type: 'string' },
          message: { type: 'string', description: 'HTML allowed' },
          senderName: { type: 'string', enum: ['OpenSteam AI', 'OpenSteam Team', 'OpenSteam Support'] },
          accentColor: { type: 'string' },
          buttonText: { type: 'string' },
          buttonUrl: { type: 'string' }
        },
        required: ['toEmail', 'subject', 'title', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sendDM',
      description: 'Send a Discord DM via the bot. Supports optional embed.',
      parameters: {
        type: 'object',
        properties: {
          discordId: { type: 'string' },
          message: { type: 'string' },
          embedTitle: { type: 'string' },
          embedDescription: { type: 'string' },
          embedColor: { type: 'number', description: 'Decimal color int' }
        },
        required: ['discordId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'postChannelMessage',
      description: 'Post a message/embed to a Discord channel by ID.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          message: { type: 'string' },
          embedTitle: { type: 'string' },
          embedDescription: { type: 'string' },
          embedColor: { type: 'number' }
        },
        required: ['channelId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listSupportTickets',
      description: 'List support tickets. status: OPEN|PENDING|CLOSED|ALL.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['OPEN', 'PENDING', 'CLOSED', 'ALL'] },
          limit: { type: 'number', description: 'Max 20' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replyToTicket',
      description: 'Email a reply to a support ticket. senderIdentity: AI|OWNER.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          replyText: { type: 'string' },
          senderIdentity: { type: 'string', enum: ['AI', 'OWNER'] },
          closeTicket: { type: 'boolean' }
        },
        required: ['ticketId', 'replyText', 'senderIdentity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'restartDiscordBot',
      description: 'Trigger a bot restart via BOT_RESTART_WEBHOOK. OWNER only.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' }
        },
        required: ['reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'triggerMaintenance',
      description: 'Run a maintenance task. enable_maintenance/disable_maintenance: OWNER only.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', enum: ['cleanup_drops', 'purge_rate_limits', 'trial_cron', 'enable_maintenance', 'disable_maintenance'] }
        },
        required: ['task']
      }
    }
  },

  {
    type: 'function',
    function: {
      name: 'listGameRequests',
      description: 'Fetch pending game requests.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'approveGameRequest',
      description: 'Mark a game request as fulfilled.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string' } },
        required: ['requestId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rejectGameRequest',
      description: 'Deny a game request.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string' }, reason: { type: 'string' } },
        required: ['requestId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'adjustUserCoins',
      description: 'Add or remove coins from a user.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' }, amount: { type: 'number', description: 'Positive or negative integer' } },
        required: ['userId', 'amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createIncident',
      description: 'Create a system incident.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['minor', 'major', 'maintenance', 'resolved'] } },
        required: ['title', 'severity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createSystemNotification',
      description: 'Publish a banner alert.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, message: { type: 'string' }, description: { type: 'string' }, type: { type: 'string', enum: ['warning', 'error'] } },
        required: ['message', 'type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'overrideTrialTest',
      description: 'Override trial test status.',
      parameters: {
        type: 'object',
        properties: { testId: { type: 'string' }, status: { type: 'string', enum: ['OVERRIDE_PASS', 'OVERRIDE_FAIL'] }, notes: { type: 'string' } },
        required: ['testId', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listUserApiKeys',
      description: 'List active API keys for a user.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'revokeApiKey',
      description: 'Disable/revoke a specific API key.',
      parameters: {
        type: 'object',
        properties: { keyId: { type: 'string' } },
        required: ['keyId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getSystemStatus',
      description: 'Get system health snapshot: user counts, API keys, jails, tickets, maintenance mode.',
      parameters: { type: 'object', properties: {} }
    }
  }
];

// Tool Implementation Logic
async function searchUsers(query: string) {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { id: { contains: query, mode: 'insensitive' } },
        { username: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
        { discordId: { contains: query, mode: 'insensitive' } }
      ]
    },
    take: 10,
    select: {
      id: true,
      username: true,
      email: true,
      discordId: true,
      role: true,
      plan: true,
      isBanned: true
    }
  });
  return users;
}

async function viewUser(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: userId },
        { discordId: userId }
      ]
    },
    include: {
      _count: {
        select: { apiKeys: true, manifests: true }
      }
    }
  });
  if (!user) return { error: 'User not found' };
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    discordId: user.discordId,
    role: user.role,
    plan: user.plan,
    isBanned: user.isBanned,
    jailLevel: user.jailLevel,
    jailUntil: user.jailUntil,
    lastIp: user.lastIp,
    fingerprint: user.fingerprint,
    createdAt: user.createdAt,
    apiKeyCount: user._count.apiKeys,
    manifestCount: user._count.manifests
  };
}

async function setPlan(userId: string, planName: string, performerId: string, performerIp?: string) {
  const p = planName.toUpperCase();
  const user = await prisma.user.update({
    where: { id: userId },
    data: { plan: p as any }
  });
  await createAuditLog(performerId, 'UPDATE_PLAN', userId, `Updated plan to ${p}`, performerIp);
  return { success: true, user: { id: user.id, username: user.username, plan: user.plan } };
}

async function setRole(userId: string, roleName: string, performerId: string, performerIp?: string) {
  const r = roleName.toUpperCase();
  const roleLevel = r === 'OWNER' ? 150 : r === 'ADMIN' ? 100 : r === 'SENIOR_MODERATOR' ? 75 : r === 'MODERATOR' ? 50 : r === 'TRIAL_MODERATOR' ? 25 : 0;
  
  const userBefore = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  
  const updateData: any = {
    role: r as any,
    roleLevel,
    ...(r === 'TRIAL_MODERATOR' ? { trialStartDate: new Date() } : {}),
    ...(r !== 'TRIAL_MODERATOR' ? { trialStartDate: null, trialWelcomeDmDeliveredAt: null } : {})
  };
  
  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData
  });
  
  if (r === 'TRIAL_MODERATOR' && userBefore?.role !== 'TRIAL_MODERATOR') {
    try {
      const { sendTrialModeratorWelcomeDm } = await import('@/app/lib/bot-admin');
      await sendTrialModeratorWelcomeDm(user.discordId, user.username, { userId: user.id });
    } catch (e) {
      console.error('[setRole Welcome DM error]', e);
    }
  }
  
  await createAuditLog(performerId, 'UPDATE_ROLE', userId, `Updated role to ${r}`, performerIp);
  return { success: true, user: { id: user.id, username: user.username, role: user.role } };
}

async function banUser(userId: string, reason: string, performerId: string, performerIp?: string) {
  const { banUserGlobally } = await import('@/app/lib/ratelimit');
  await banUserGlobally(userId, reason || 'Banned by Admin Chatbot');
  
  try {
    const { sendBotDM } = await import('@/app/lib/bot-admin');
    const { sendBrandedEmail } = await import('@/app/lib/email');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      if (user.discordId) {
        await sendBotDM(user.discordId, '', {
          title: 'Account Banned',
          description: `Your OpenSteam account has been permanently banned. Reason: ${reason || 'Administrative decision'}. To appeal, contact us via the support portal.`,
          color: 0xef4444,
          footer: { text: 'OpenSteam' }
        });
      }
      if (user.email) {
        await sendBrandedEmail(
          user.email,
          'Your OpenSteam account has been banned',
          'Account Banned',
          `Your account has been permanently banned and all API access has been revoked.<br><br><strong>Reason:</strong> ${reason || 'Administrative decision'}<br><br>If you believe this decision was made in error, you can submit an appeal through our support portal.`,
          '#ef4444',
          undefined,
          {
            buttonText: 'Submit an Appeal',
            buttonUrl: 'http://127.0.0.1:3000/support',
            securityNotice: 'This action was taken by an administrator. Your API keys are disabled and cannot be re-enabled without a successful appeal.'
          }
        );
      }
    }
  } catch (e) {
    console.error('[banUser Notification Error]', e);
  }
  
  await createAuditLog(performerId, 'BAN_USER', userId, `Globally banned user. Reason: ${reason}`, performerIp);
  return { success: true, message: `Successfully banned user ${userId}` };
}

async function unbanUser(userId: string, performerId: string, performerIp?: string) {
  const { unbanUserGlobally } = await import('@/app/lib/ratelimit');
  await unbanUserGlobally(userId);
  
  try {
    const { sendBotDM } = await import('@/app/lib/bot-admin');
    const { sendBrandedEmail } = await import('@/app/lib/email');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      if (user.discordId) {
        await sendBotDM(user.discordId, '', {
          title: 'Account Access Restored',
          description: 'Your OpenSteam account restrictions have been lifted and your API keys have been re-enabled.',
          color: 0x16a34a,
          footer: { text: 'OpenSteam' }
        });
      }
      if (user.email) {
        await sendBrandedEmail(
          user.email,
          'Your OpenSteam account has been restored',
          'Account Access Restored',
          'Your account restrictions have been lifted. API access has been re-enabled and your previous configuration is active.',
          '#16a34a',
          undefined,
          { buttonText: 'Go to Dashboard', buttonUrl: 'http://127.0.0.1:3000/dashboard' }
        );
      }
    }
  } catch (e) {
    console.error('[unbanUser Notification Error]', e);
  }
  
  await createAuditLog(performerId, 'UNBAN_USER', userId, 'Globally unbanned user.', performerIp);
  return { success: true, message: `Successfully unbanned user ${userId}` };
}

async function banFromDiscordGuild(discordId: string, reason: string, performerId: string, performerIp?: string) {
  const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
  const guildConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } });
  
  const botToken = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
  const guildId = guildConfig?.value;
  
  if (!botToken || !guildId) {
    return { error: 'Discord bot token or guild ID is not configured in settings.' };
  }
  
  const url = `https://discord.com/api/v10/guilds/${guildId}/bans/${discordId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      delete_message_seconds: 604800,
      reason: reason || 'Banned via Admin Chatbot'
    })
  });
  
  if (!res.ok) {
    const errText = await res.text();
    return { error: `Discord API returned error status ${res.status}: ${errText}` };
  }
  
  await createAuditLog(performerId, 'DISCORD_GUILD_BAN', discordId, `Banned discord user from guild. Reason: ${reason}`, performerIp);
  return { success: true, message: `Successfully banned discord user ${discordId} from guild ${guildId}` };
}

async function listIpJails() {
  const activeJails = await (prisma as any).rateLimitState.findMany({
    where: {
      blockedUntil: {
        gt: new Date()
      }
    },
    orderBy: { blockedUntil: 'desc' }
  });
  return activeJails;
}

async function clearIpJail(ipOrKey: string, performerId: string, performerIp?: string) {
  await (prisma as any).rateLimitState.deleteMany({
    where: { key: ipOrKey }
  });
  
  await (prisma as any).blacklistedIp.deleteMany({
    where: { ip: ipOrKey }
  }).catch(() => ({ count: 0 }));
  
  try {
    const { refreshBlacklist } = await import('@/app/lib/ratelimit');
    refreshBlacklist();
  } catch {}
  
  await createAuditLog(performerId, 'CLEAR_IP_JAIL', ipOrKey, `Cleared rate limit jail and/or IP blacklist for key: ${ipOrKey}`, performerIp);
  return { success: true, message: `Successfully cleared jail/block for ${ipOrKey}` };
}

async function queryAuditLogs(action?: string, targetId?: string, query?: string, date?: string) {
  const where: any = {};
  if (action) {
    where.action = action;
  }
  if (targetId) {
    where.targetId = targetId;
  }
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    where.createdAt = {
      gte: start,
      lte: end
    };
  }
  
  const logs = await (prisma as any).auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: { select: { username: true, role: true } }
    }
  });
  
  let filtered = logs;
  if (query) {
    const lowercaseQuery = query.toLowerCase();
    filtered = logs.filter((l: any) => {
      const detailsStr = l.details ? (typeof l.details === 'string' ? l.details : JSON.stringify(l.details)) : '';
      return detailsStr.toLowerCase().includes(lowercaseQuery);
    });
  }
  
  return filtered.slice(0, 15).map((l: any) => ({
    id: l.id,
    performer: l.user?.username,
    performerRole: l.user?.role,
    action: l.action,
    targetId: l.targetId,
    details: l.details,
    createdAt: l.createdAt
  }));
}

// ── New expanded tool implementations ─────────────────────────────────────────

async function sendEmailTool(
  toEmail: string, subject: string, title: string, message: string,
  senderName?: string, accentColor?: string, buttonText?: string, buttonUrl?: string,
  performerId?: string, performerIp?: string
) {
  const { sendBrandedEmail } = await import('@/app/lib/email');
  const senderTag = senderName || 'OpenSteam Support';
  const color = accentColor || '#6366f1';

  await sendBrandedEmail(
    toEmail, subject, title,
    message.replace(/\n/g, '<br>'),
    color,
    { 'X-Sender-Identity': senderTag },
    {
      buttonText: buttonText || 'Open Dashboard',
      buttonUrl: buttonUrl || 'http://127.0.0.1:3000/dashboard',
    }
  );

  if (performerId) {
    await createAuditLog(performerId, 'SEND_EMAIL', toEmail, `Sent email: "${subject}" as "${senderTag}"`, performerIp);
  }

  return { success: true, message: `Email sent to ${toEmail} as "${senderTag}" with subject "${subject}"` };
}

async function sendDMTool(
  discordId: string, message?: string,
  embedTitle?: string, embedDescription?: string, embedColor?: number,
  performerId?: string, performerIp?: string
) {
  const { sendBotDM } = await import('@/app/lib/bot-admin');
  const embed = (embedTitle || embedDescription) ? {
    title: embedTitle,
    description: embedDescription,
    color: typeof embedColor === 'number' ? embedColor : 0x6366f1,
    timestamp: new Date().toISOString(),
    footer: { text: 'OpenSteam' }
  } : undefined;

  const ok = await sendBotDM(discordId, message || '', embed);

  if (performerId) {
    await createAuditLog(performerId, 'SEND_DM', discordId, `Sent DM to Discord user ${discordId}`, performerIp);
  }

  if (!ok) return { error: `Failed to send DM to ${discordId}. The user may have DMs disabled or the bot is not in a shared server with them.` };
  return { success: true, message: `DM sent successfully to Discord user ${discordId}` };
}

async function postChannelMessageTool(
  channelId: string, message?: string,
  embedTitle?: string, embedDescription?: string, embedColor?: number,
  performerId?: string, performerIp?: string
) {
  const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
  const botToken = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { error: 'Discord bot token is not configured.' };

  const body: any = {};
  if (message) body.content = message;
  if (embedTitle || embedDescription) {
    body.embeds = [{
      title: embedTitle,
      description: embedDescription,
      color: typeof embedColor === 'number' ? embedColor : 0x6366f1,
      timestamp: new Date().toISOString(),
      footer: { text: 'OpenSteam' }
    }];
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    return { error: `Discord API error (${res.status}): ${err}` };
  }

  if (performerId) {
    await createAuditLog(performerId, 'POST_CHANNEL_MESSAGE', channelId, `Posted message to channel ${channelId}`, performerIp);
  }

  return { success: true, message: `Message posted to channel ${channelId}` };
}

async function listSupportTickets(status?: string, limit?: number) {
  const safeLimit = Math.min(typeof limit === 'number' ? limit : 10, 20);
  const where: any = {};
  if (status && status !== 'ALL') {
    where.status = status;
  }

  try {
    const tickets = await (prisma as any).supportTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        subject: true,
        fromEmail: true,
        status: true,
        createdAt: true,
        aiReply: true,
      }
    });
    return tickets;
  } catch (e: any) {
    return { error: `Failed to query support tickets: ${e.message}` };
  }
}

async function replyToTicket(
  ticketId: string, replyText: string, senderIdentity: 'AI' | 'OWNER',
  closeTicket?: boolean, performerId?: string, performerIp?: string
) {
  try {
    const ticket = await (prisma as any).supportTicket.findUnique({
      where: { id: ticketId }
    });
    if (!ticket) return { error: `Support ticket ${ticketId} not found.` };

    // Compose email in the right voice
    const senderName = senderIdentity === 'AI' ? 'OpenSteam AI' : 'OpenSteam Team';
    const emailSubject = `Re: ${ticket.subject || 'Your Support Request'} — OpenSteam`;
    const emailTitle = senderIdentity === 'AI' ? 'AI Assistant Response' : 'Support Team Response';
    const signatureNote = senderIdentity === 'AI'
      ? '<br><br><em>This reply was composed by the OpenSteam AI moderation assistant on behalf of the support team.</em>'
      : '<br><br><em>— OpenSteam Support Team</em>';

    const { sendBrandedEmail } = await import('@/app/lib/email');
    await sendBrandedEmail(
      ticket.fromEmail,
      emailSubject,
      emailTitle,
      replyText.replace(/\n/g, '<br>') + signatureNote,
      senderIdentity === 'AI' ? '#6366f1' : '#10b981',
      undefined,
      { buttonText: 'Contact Support', buttonUrl: 'http://127.0.0.1:3000/support' }
    );

    // Update ticket record
    const newStatus = closeTicket ? 'CLOSED' : ticket.status;
    await (prisma as any).supportTicket.update({
      where: { id: ticketId },
      data: {
        aiReply: replyText,
        aiRepliedAt: new Date(),
        status: newStatus,
        ...(senderIdentity === 'OWNER' ? { staffRepliedAt: new Date() } : {})
      }
    });

    if (performerId) {
      await createAuditLog(performerId, 'REPLY_TICKET', ticketId, `Replied to ticket "${ticket.subject}" as ${senderName}. Closed: ${!!closeTicket}`, performerIp);
    }

    return {
      success: true,
      message: `Reply sent to ${ticket.fromEmail} as "${senderName}". Ticket status: ${newStatus}.`
    };
  } catch (e: any) {
    return { error: `Failed to reply to ticket: ${e.message}` };
  }
}

async function restartDiscordBot(reason: string, performerId?: string, performerIp?: string) {
  try {
    const webhookConfig = await prisma.systemConfig.findUnique({ where: { key: 'BOT_RESTART_WEBHOOK' } });
    const webhookUrl = webhookConfig?.value || process.env.BOT_RESTART_WEBHOOK;

    if (!webhookUrl) {
      return { error: 'BOT_RESTART_WEBHOOK is not configured in SystemConfig or environment variables. Please set this to a URL that restarts the bot (e.g. a PM2 restart endpoint or a custom webhook).' };
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, requestedBy: performerId, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000)
    });

    if (performerId) {
      await createAuditLog(performerId, 'BOT_RESTART', 'discord-bot', `Triggered bot restart. Reason: ${reason}. Webhook status: ${res.status}`, performerIp);
    }

    if (!res.ok) {
      return { error: `Restart webhook responded with HTTP ${res.status}. Bot restart may or may not have succeeded.` };
    }

    return { success: true, message: `Discord bot restart triggered. Reason: "${reason}". The bot should reconnect within 30 seconds.` };
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { error: isTimeout ? 'Restart webhook timed out. The bot process may still have restarted — check bot status.' : `Failed to trigger restart: ${e.message}` };
  }
}

async function triggerMaintenance(task: string, performerId?: string, performerIp?: string) {
  const action = `MAINTENANCE_${task.toUpperCase()}`;

  if (task === 'cleanup_drops') {
    const { cleanupExpiredDrops } = await import('@/app/lib/bot-admin');
    const count = await cleanupExpiredDrops();
    if (performerId) await createAuditLog(performerId, action, 'system', `Cleaned up ${count} expired drops`, performerIp);
    return { success: true, message: `Cleaned up ${count} expired manifest drops.` };
  }

  if (task === 'purge_rate_limits') {
    // Delete rate limit states that expired more than 1 hour ago (safe to purge)
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const { count } = await (prisma as any).rateLimitState.deleteMany({
      where: { blockedUntil: { lt: cutoff } }
    });
    if (performerId) await createAuditLog(performerId, action, 'system', `Purged ${count} expired rate limit states`, performerIp);
    return { success: true, message: `Purged ${count} expired rate limit states (older than 1h).` };
  }

  if (task === 'trial_cron') {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) return { error: 'ADMIN_API_KEY not configured — cannot trigger trial cron internally.' };
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await fetch(`${origin}/api/admin/trial/cron`, {
      headers: { 'Authorization': `Bearer ${adminKey}` }
    });
    const data = await res.json();
    if (performerId) await createAuditLog(performerId, action, 'system', `Ran trial cron: ${JSON.stringify(data)}`, performerIp);
    return { success: true, ...data };
  }

  if (task === 'enable_maintenance' || task === 'disable_maintenance') {
    const enabled = task === 'enable_maintenance';
    await prisma.systemConfig.upsert({
      where: { key: 'MAINTENANCE_MODE' },
      update: { value: enabled ? 'true' : 'false' },
      create: { key: 'MAINTENANCE_MODE', value: enabled ? 'true' : 'false' }
    });
    if (performerId) await createAuditLog(performerId, action, 'system', `Maintenance mode set to ${enabled}`, performerIp);
    return { success: true, message: `Maintenance mode ${enabled ? 'ENABLED' : 'DISABLED'}.` };
  }

  return { error: `Unknown maintenance task: ${task}` };
}

async function getSystemStatus() {
  try {
    const [
      totalUsers, bannedUsers, activeApiKeys,
      activeJails, openTickets, maintenanceMode, recentErrors
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isBanned: true } }),
      prisma.apiKey.count({ where: { enabled: true } }),
      (prisma as any).rateLimitState.count({ where: { blockedUntil: { gt: new Date() } } }),
      (prisma as any).supportTicket.findMany({
        where: { status: { in: ['OPEN', 'PENDING'] } },
        select: { id: true, subject: true, fromEmail: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5
      }).catch(() => []),
      prisma.systemConfig.findUnique({ where: { key: 'MAINTENANCE_MODE' } }),
      prisma.sentinelLog.findMany({
        where: { action: { in: ['AUTO_JAIL', 'BLACKLIST_IP'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { userId: true, action: true, reason: true, createdAt: true }
      }).catch(() => [])
    ]);

    return {
      platform: {
        totalUsers,
        bannedUsers,
        activeApiKeys,
        activeIpJails: activeJails,
        maintenanceMode: maintenanceMode?.value === 'true'
      },
      support: {
        openTickets: Array.isArray(openTickets) ? openTickets.length : 0,
        recentOpenTickets: openTickets
      },
      recentSecurityEvents: recentErrors,
      generatedAt: new Date().toISOString()
    };
  } catch (e: any) {
    return { error: `Failed to fetch system status: ${e.message}` };
  }
}



async function listGameRequests() {
  return await (prisma as any).gameRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { user: { select: { username: true } } }
  });
}

async function approveGameRequest(requestId: string, performerId?: string, performerIp?: string) {
  const req = await (prisma as any).gameRequest.update({
    where: { id: requestId },
    data: { status: 'FULFILLED' }
  });
  if (performerId) await createAuditLog(performerId, 'APPROVE_GAME_REQUEST', requestId, `Approved request ${req.name}`, performerIp);
  return { success: true, request: req };
}

async function rejectGameRequest(requestId: string, reason?: string, performerId?: string, performerIp?: string) {
  const req = await (prisma as any).gameRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED' }
  });
  if (performerId) await createAuditLog(performerId, 'REJECT_GAME_REQUEST', requestId, `Rejected request ${req.name}. Reason: ${reason}`, performerIp);
  return { success: true, request: req };
}

async function adjustUserCoins(userId: string, amount: number, performerId?: string, performerIp?: string) {
  // `users.coins` is a Postgres int4 column; a plain atomic increment throws
  // "integer out of range" (22003) once the balance would exceed 2^31-1. Clamp
  // the new balance in SQL (cast to bigint so the intermediate sum can't
  // overflow) between 0 and the int4 ceiling.
  const MAX_COINS = 2147483647
  const delta = Math.trunc(Number(amount) || 0)
  await prisma.$executeRaw`UPDATE "users" SET coins = GREATEST(LEAST(coins::bigint + ${delta}::bigint, ${MAX_COINS}::bigint), 0)::int WHERE id = ${userId}`
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, coins: true }
  })
  if (performerId) await createAuditLog(performerId, 'ADJUST_COINS', userId, `Adjusted coins by ${amount}. New balance: ${user?.coins}`, performerIp)
  return { success: true, user }
}

async function createIncident(title: string, severity: string, performerId?: string, performerIp?: string) {
  const incident = await (prisma as any).incident.create({
    data: { title, severity }
  });
  if (performerId) await createAuditLog(performerId, 'CREATE_INCIDENT', incident.id, `Created incident: ${title}`, performerIp);
  return { success: true, incident };
}

async function createSystemNotification(title: string, message: string, description: string, type: string, performerId?: string, performerIp?: string) {
  const notif = await (prisma as any).systemNotification.create({
    data: { title, message, description, type, active: true }
  });
  if (performerId) await createAuditLog(performerId, 'CREATE_SYSTEM_NOTIFICATION', notif.id, `Created notification: ${title}`, performerIp);
  return { success: true, notification: notif };
}

async function overrideTrialTest(testId: string, status: string, notes?: string, performerId?: string, performerIp?: string) {
  const test = await (prisma as any).trialTest.update({
    where: { id: testId },
    data: { status, adminNotes: notes, adminId: performerId, gradedAt: new Date() }
  });
  if (performerId) await createAuditLog(performerId, 'OVERRIDE_TRIAL_TEST', testId, `Set test to ${status}. Notes: ${notes}`, performerIp);
  return { success: true, test };
}

async function listUserApiKeys(userId: string) {
  return await (prisma as any).apiKey.findMany({
    where: { userId },
    select: { id: true, name: true, enabled: true, rateLimit: true, createdAt: true, lastUsed: true }
  });
}

async function revokeApiKey(keyId: string, performerId?: string, performerIp?: string) {
  const key = await (prisma as any).apiKey.update({
    where: { id: keyId },
    data: { enabled: false, adminDisable: true }
  });
  if (performerId) await createAuditLog(performerId, 'REVOKE_API_KEY', keyId, `Revoked API key: ${key.name}`, performerIp);
  return { success: true, key };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const caller = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    });
    
    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden. Admin/Owner access required.' }, { status: 403 });
    }

    const activeJailsCount = await (prisma as any).rateLimitState.count({
      where: {
        blockedUntil: {
          gt: new Date()
        }
      }
    });

    const bannedUsersCount = await prisma.user.count({
      where: {
        isBanned: true
      }
    });

    const totalUsersCount = await prisma.user.count();

    const auditLogsCount = await (prisma as any).auditLog.count();

    return NextResponse.json({
      activeJailsCount,
      bannedUsersCount,
      totalUsersCount,
      auditLogsCount
    });
  } catch (error) {
    console.error('Moderation Bot GET Stats Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const caller = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    });
    
    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden. Admin/Owner access required.' }, { status: 403 });
    }
    
    const { messages } = await request.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages body' }, { status: 400 });
    }

    if (messages.length > 50) {
      return NextResponse.json({ error: 'Payload too large. Maximum conversation history exceeded.' }, { status: 400 });
    }

    for (const m of messages) {
      if (!m || typeof m !== 'object' || typeof m.content !== 'string' || typeof m.role !== 'string') {
        return NextResponse.json({ error: 'Malformed message objects in payload.' }, { status: 400 });
      }
      if (m.content.length > 2000) {
        return NextResponse.json({ error: 'Prompt length exceeds secure character limit.' }, { status: 400 });
      }
    }
    
    const apiKey = process.env.GROQ_API_KEY?.trim() || (await prisma.systemConfig.findUnique({ where: { key: 'GROQ_API_KEY' } }))?.value;
    if (!apiKey) {
      return NextResponse.json({ error: 'Groq API Key is not configured on this server.' }, { status: 500 });
    }
    
    const performerIp = getClientIp(request);
    
    const systemPrompt = `You are the OpenSteam admin/moderation AI. Use tools to act immediately without asking for confirmation. Summarize outcomes clearly using Markdown. Never fabricate user data — fetch via tools first. All actions are audit-logged.

Performer: ${caller.username} (${caller.role}) | ID: ${caller.id} | ${new Date().toISOString()}

restartDiscordBot and enable/disable_maintenance are OWNER-only.`;


    let currentMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    
    let responseMessage = null;
    let loopCount = 0;
    const maxLoops = 5;
    
    // We will keep track of what tools we executed to display them beautifully to the admin if needed.
    const executedTools: any[] = [];
    
    while (loopCount < maxLoops) {
      loopCount++;
      
      // AbortController gives us a hard 25-second timeout per call
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25_000);

      let result;
      try {
        result = await callLlmWithFallback({
          messages: currentMessages,
          tools: tools,
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: 1024,
          signal: controller.signal
        });
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        const isAbort = fetchErr?.name === 'AbortError';
        console.error('[Moderation Bot] AI fetch error:', fetchErr);
        return NextResponse.json({
          error: isAbort
            ? 'AI API request timed out after 25 seconds. The model may be overloaded — try again.'
            : `AI API network error: ${fetchErr.message}`
        }, { status: 502 });
      } finally {
        clearTimeout(timeoutId);
      }
      
      if (!result || !result.message) {
        return NextResponse.json({ error: 'Received empty response or failed to reach AI model (all fallbacks exhausted)' }, { status: 500 });
      }
      
      responseMessage = result.message;
      currentMessages.push(responseMessage);
      
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          const name = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments || '{}');
          
          let toolResult: any;
          executedTools.push({ name, args });
          
          try {
            if (name === 'searchUsers') {
              if (typeof args.query !== 'string') throw new Error('Invalid query type: query must be a string');
              toolResult = await searchUsers(args.query);
            } else if (name === 'viewUser') {
              if (typeof args.userId !== 'string') throw new Error('Invalid userId type: userId must be a string');
              toolResult = await viewUser(args.userId);
            } else if (name === 'setPlan') {
              if (typeof args.userId !== 'string') throw new Error('Invalid userId type: userId must be a string');
              if (typeof args.plan !== 'string') throw new Error('Invalid plan type: plan must be a string');
              toolResult = await setPlan(args.userId, args.plan, caller.id, performerIp);
            } else if (name === 'setRole') {
              if (typeof args.userId !== 'string') throw new Error('Invalid userId type: userId must be a string');
              if (typeof args.role !== 'string') throw new Error('Invalid role type: role must be a string');
              toolResult = await setRole(args.userId, args.role, caller.id, performerIp);
            } else if (name === 'banUser') {
              if (typeof args.userId !== 'string') throw new Error('Invalid userId type: userId must be a string');
              if (typeof args.reason !== 'string') throw new Error('Invalid reason type: reason must be a string');
              toolResult = await banUser(args.userId, args.reason, caller.id, performerIp);
            } else if (name === 'unbanUser') {
              if (typeof args.userId !== 'string') throw new Error('Invalid userId type: userId must be a string');
              toolResult = await unbanUser(args.userId, caller.id, performerIp);
            } else if (name === 'banFromDiscordGuild') {
              if (typeof args.discordId !== 'string') throw new Error('Invalid discordId type: discordId must be a string');
              if (typeof args.reason !== 'string') throw new Error('Invalid reason type: reason must be a string');
              toolResult = await banFromDiscordGuild(args.discordId, args.reason, caller.id, performerIp);
            } else if (name === 'listIpJails') {
              toolResult = await listIpJails();
            } else if (name === 'clearIpJail') {
              if (typeof args.ipOrKey !== 'string') throw new Error('Invalid ipOrKey type: ipOrKey must be a string');
              toolResult = await clearIpJail(args.ipOrKey, caller.id, performerIp);
            } else if (name === 'queryAuditLogs') {
              const action = typeof args.action === 'string' ? args.action : undefined;
              const targetId = typeof args.targetId === 'string' ? args.targetId : undefined;
              const query = typeof args.query === 'string' ? args.query : undefined;
              const date = typeof args.date === 'string' ? args.date : undefined;
              toolResult = await queryAuditLogs(action, targetId, query, date);
            } else if (name === 'sendEmail') {
              if (typeof args.toEmail !== 'string') throw new Error('toEmail must be a string');
              if (typeof args.subject !== 'string') throw new Error('subject must be a string');
              if (typeof args.title !== 'string') throw new Error('title must be a string');
              if (typeof args.message !== 'string') throw new Error('message must be a string');
              // Basic email format guard
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.toEmail)) throw new Error('Invalid toEmail format');
              if (args.message.length > 5000) throw new Error('Email message too long (max 5000 chars)');
              toolResult = await sendEmailTool(
                args.toEmail, args.subject, args.title, args.message,
                typeof args.senderName === 'string' ? args.senderName : undefined,
                typeof args.accentColor === 'string' ? args.accentColor : undefined,
                typeof args.buttonText === 'string' ? args.buttonText : undefined,
                typeof args.buttonUrl === 'string' ? args.buttonUrl : undefined,
                caller.id, performerIp
              );
            } else if (name === 'sendDM') {
              if (typeof args.discordId !== 'string') throw new Error('discordId must be a string');
              toolResult = await sendDMTool(
                args.discordId,
                typeof args.message === 'string' ? args.message : undefined,
                typeof args.embedTitle === 'string' ? args.embedTitle : undefined,
                typeof args.embedDescription === 'string' ? args.embedDescription : undefined,
                typeof args.embedColor === 'number' ? args.embedColor : undefined,
                caller.id, performerIp
              );
            } else if (name === 'postChannelMessage') {
              if (typeof args.channelId !== 'string') throw new Error('channelId must be a string');
              toolResult = await postChannelMessageTool(
                args.channelId,
                typeof args.message === 'string' ? args.message : undefined,
                typeof args.embedTitle === 'string' ? args.embedTitle : undefined,
                typeof args.embedDescription === 'string' ? args.embedDescription : undefined,
                typeof args.embedColor === 'number' ? args.embedColor : undefined,
                caller.id, performerIp
              );
            } else if (name === 'listSupportTickets') {
              const status = typeof args.status === 'string' ? args.status : undefined;
              const limit = typeof args.limit === 'number' ? args.limit : undefined;
              toolResult = await listSupportTickets(status, limit);
            } else if (name === 'replyToTicket') {
              if (typeof args.ticketId !== 'string') throw new Error('ticketId must be a string');
              if (typeof args.replyText !== 'string') throw new Error('replyText must be a string');
              if (args.replyText.length > 5000) throw new Error('Reply text too long (max 5000 chars)');
              const identity = args.senderIdentity === 'OWNER' ? 'OWNER' : 'AI';
              toolResult = await replyToTicket(
                args.ticketId, args.replyText, identity,
                typeof args.closeTicket === 'boolean' ? args.closeTicket : false,
                caller.id, performerIp
              );
            } else if (name === 'restartDiscordBot') {
              if (typeof args.reason !== 'string') throw new Error('reason must be a string');
              // Only OWNER can restart the bot
              if ((caller.role as string) !== 'OWNER') {
                toolResult = { error: 'Bot restart is restricted to OWNER role only.' };
              } else {
                toolResult = await restartDiscordBot(args.reason, caller.id, performerIp);
              }
            } else if (name === 'triggerMaintenance') {
              if (typeof args.task !== 'string') throw new Error('task must be a string');
              // Only OWNER can toggle maintenance mode; admins can run cleanup tasks
              const ownerOnlyTasks = ['enable_maintenance', 'disable_maintenance'];
              if (ownerOnlyTasks.includes(args.task) && (caller.role as string) !== 'OWNER') {
                toolResult = { error: `Maintenance task "${args.task}" is restricted to OWNER role only.` };
              } else {
                toolResult = await triggerMaintenance(args.task, caller.id, performerIp);
              }
            
            } else if (name === 'listGameRequests') {
              toolResult = await listGameRequests();
            } else if (name === 'approveGameRequest') {
              if (typeof args.requestId !== 'string') throw new Error('requestId must be a string');
              toolResult = await approveGameRequest(args.requestId, caller.id, performerIp);
            } else if (name === 'rejectGameRequest') {
              if (typeof args.requestId !== 'string') throw new Error('requestId must be a string');
              toolResult = await rejectGameRequest(args.requestId, args.reason, caller.id, performerIp);
            } else if (name === 'adjustUserCoins') {
              if (typeof args.userId !== 'string') throw new Error('userId must be a string');
              if (typeof args.amount !== 'number') throw new Error('amount must be a number');
              toolResult = await adjustUserCoins(args.userId, args.amount, caller.id, performerIp);
            } else if (name === 'createIncident') {
              if (typeof args.title !== 'string') throw new Error('title must be a string');
              if (typeof args.severity !== 'string') throw new Error('severity must be a string');
              toolResult = await createIncident(args.title, args.severity, caller.id, performerIp);
            } else if (name === 'createSystemNotification') {
              if (typeof args.message !== 'string') throw new Error('message must be a string');
              toolResult = await createSystemNotification(args.title, args.message, args.description, args.type, caller.id, performerIp);
            } else if (name === 'overrideTrialTest') {
              if (typeof args.testId !== 'string') throw new Error('testId must be a string');
              if (typeof args.status !== 'string') throw new Error('status must be a string');
              toolResult = await overrideTrialTest(args.testId, args.status, args.notes, caller.id, performerIp);
            } else if (name === 'listUserApiKeys') {
              if (typeof args.userId !== 'string') throw new Error('userId must be a string');
              toolResult = await listUserApiKeys(args.userId);
            } else if (name === 'revokeApiKey') {
              if (typeof args.keyId !== 'string') throw new Error('keyId must be a string');
              toolResult = await revokeApiKey(args.keyId, caller.id, performerIp);
} else if (name === 'getSystemStatus') {
              toolResult = await getSystemStatus();
            } else {
              toolResult = { error: `Tool ${name} not found.` };
            }
          } catch (err: any) {
            console.error(`Error executing tool ${name}:`, err);
            toolResult = { error: err.message || 'Execution failed' };
          }
          
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: name,
            content: JSON.stringify(toolResult)
          } as any);
        }
      } else {
        break;
      }
    }
    
    return NextResponse.json({
      reply: responseMessage?.content || 'No text reply generated.',
      executedTools
    });
    
  } catch (error) {
    console.error('Moderation Bot Endpoint Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
