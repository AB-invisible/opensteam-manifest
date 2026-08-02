import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { v4 as uuidv4 } from 'uuid'
import { sendWebhook } from '@/app/lib/webhooks'
import { assertDiscordGuildAccess } from '@/app/lib/discord-guild-restrictions'

export async function GET(request: NextRequest) {
  try {
    const headers = corsHeaders(request.headers.get('Origin'))
    const session = await getServerSession(authOptions)

    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      )
    }

    const user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404, headers }
      )
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        key: true,
        name: true,
        rateLimit: true,
        rateWindow: true,
        enabled: true,
        createdAt: true,
        lastUsed: true,
        _count: {
          select: { usage: true }
        }
      }
    })

    return NextResponse.json({ apiKeys }, { headers })
  } catch (error) {
    console.error('Error fetching API keys:', error)
    return NextResponse.json(
      { error: 'Failed to fetch API keys' },
      { status: 500, headers: corsHeaders(request.headers.get('Origin')) }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const headers = corsHeaders(request.headers.get('Origin'))
    const session = await getServerSession(authOptions)

    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      )
    }

    const { name } = await request.json()

    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400, headers }
      )
    }

    // API keys for the desktop app are issued via Discord (/key pair) — one per device.
    const sessionRole = (session.user as { role?: string }).role
    const isStaff = sessionRole && ['ADMIN', 'OWNER', 'EXECUTIVE_OFFICER'].includes(sessionRole)
    if (!isStaff) {
      return NextResponse.json(
        {
          error: 'API keys are issued in Discord only. Open OpenSteam App → Settings → Get API key, then run /key pair in the server.',
          code: 'DISCORD_ONLY',
        },
        { status: 403, headers }
      )
    }

    const creationConfig = await prisma.systemConfig.findUnique({ where: { key: 'KEYS_CREATION_ENABLED' } });
    if (creationConfig && creationConfig.value === 'false') {
      return NextResponse.json({ error: 'API Key creation is currently suspended for maintenance.' }, { status: 503, headers })
    }

    const user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404, headers }
      )
    }

    const guildAccess = assertDiscordGuildAccess(user)
    if (!guildAccess.ok) {
      return NextResponse.json({ error: guildAccess.error, code: guildAccess.code }, { status: 403, headers })
    }

    let rateLimit = 15; // Default for FREE
    const rateWindow = 3600; // 1 hour window

    switch (user.plan) {
      case 'REGULAR':
        rateLimit = 500;
        break;
      case 'PREMIUM':
        rateLimit = 5000;
        break;
      case 'RESELLER':
      case 'CUSTOM':
        rateLimit = 20000;
        break;
    }

    const apiKey = await prisma.apiKey.create({
      data: {
        key: `mg_${uuidv4().replace(/-/g, '')}`,
        name,
        userId: user.id,
        rateLimit,
        rateWindow
      }
    })

    // Send notifications on creation (Bot DM + Branded Email)
    try {
      const { sendBotDM } = await import('@/app/lib/bot-admin');
      const { sendBrandedEmail } = await import('@/app/lib/email');

      if (user.discordId) {
        await sendBotDM(user.discordId, '', {
          title: '🔑 API Key Created',
          description: `A new API key **${name}** was successfully generated on your account.`,
          color: 0x10b981,
          timestamp: new Date().toISOString(),
          footer: { text: 'OpenSteam Network Security' }
        }).catch(() => {});
      }

      if (user.email) {
        await sendBrandedEmail(
          user.email,
          'New OpenSteam API Key Created',
          '🔑 API Key Created',
          `Hello ${user.username || 'Developer'},<br><br>A new API key has been generated for your account:<br><br><strong>Key Name:</strong> ${name}<br><strong>Rate Limit:</strong> ${rateLimit} requests / hour<br><br>You can manage and monitor your API keys anytime in your dashboard at <a href="http://127.0.0.1:3000/dashboard" style="color: #6366f1; text-decoration: underline;">opensteam.lol/dashboard</a>.`,
          '#10b981'
        ).catch(() => {});
      }
    } catch (e) {
      console.error('Error sending API key creation notifications:', e);
    }

    // Webhook for key creation
    sendWebhook('KEY_CREATED', {
      username: user.username,
      keyName: name,
      userId: user.id,
      plan: user.plan
    })

    return NextResponse.json({ apiKey }, { headers })
  } catch (error) {
    console.error('Error creating API key:', error)
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500, headers: corsHeaders(request.headers.get('Origin')) }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const headers = corsHeaders(request.headers.get('Origin'))
    const session = await getServerSession(authOptions)

    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      )
    }

    const { keyId } = await request.json()

    if (!keyId) {
      return NextResponse.json(
        { error: 'Key ID is required' },
        { status: 400, headers }
      )
    }

    const user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404, headers }
      )
    }

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: keyId,
        userId: user.id
      }
    })

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404, headers }
      )
    }

    await prisma.apiKey.delete({
      where: { id: apiKey.id }
    })

    const { sendBotDM } = await import('@/app/lib/bot-admin');
    const { sendEmail } = await import('@/app/lib/email');

    const msg = '';
    const embed = {
      title: '⚠️ API Key Deleted',
      description: `Your API Key **${apiKey.name}** was deleted from your account.`,
      color: 0xdc2626,
      timestamp: new Date().toISOString(),
      footer: { text: 'OpenSteam Network Security' }
    };

    if (user.discordId) {
      await sendBotDM(user.discordId, msg, embed);
    }

    if (user.email) {
      const { sendBrandedEmail } = await import('@/app/lib/email');
      await sendBrandedEmail(
        user.email,
        'Your OpenSteam API Key was Deleted',
        '⚠️ API Key Deleted',
        `Your API key <strong>${apiKey.name}</strong> was deleted from your account. If you did not perform this action, please reset your credentials immediately.`,
        '#dc2626'
      ).catch(() => {});
    }

    // Webhook for key deletion
    sendWebhook('KEY_DELETED', {
      username: user.username,
      keyName: apiKey.name,
      userId: user.id
    })

    return NextResponse.json({ success: true }, { headers })
  } catch (error) {
    console.error('Error deleting API key:', error)
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500, headers: corsHeaders(request.headers.get('Origin')) }
    )
  }
}
