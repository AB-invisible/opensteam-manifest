import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey } from '@/app/lib/auth'
import axios from 'axios'

type AuthUser = { id: string; role: string }

async function resolveBroadcastAdmin(request: NextRequest): Promise<AuthUser | null> {
  const auth = await authenticateApiKey(request, { skipUsage: true })

  if (auth) {
    return auth.user
  }

  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { id: true, role: true },
  })

  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    return null
  }

  return user
}

async function clearBroadcastProgress(userId: string) {
  await prisma.systemConfig.upsert({
    where: { key: 'BROADCAST_PROGRESS' },
    update: {
      value: JSON.stringify({
        status: 'IDLE',
        total: 0,
        current: 0,
        success: 0,
        fail: 0,
        clearedAt: new Date().toISOString(),
        clearedBy: userId,
      }),
    },
    create: {
      key: 'BROADCAST_PROGRESS',
      value: JSON.stringify({ status: 'IDLE', total: 0, current: 0, success: 0, fail: 0 }),
    },
  })
}

export async function GET(request: NextRequest) {
  const user = await resolveBroadcastAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const progress = await prisma.systemConfig.findUnique({ where: { key: 'BROADCAST_PROGRESS' } })
  return NextResponse.json(progress?.value ? JSON.parse(progress.value) : { status: 'IDLE' })
}

/** Clears a stuck broadcast lock so a new broadcast can be started. Does not stop in-flight DMs. */
export async function DELETE(request: NextRequest) {
  const user = await resolveBroadcastAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await clearBroadcastProgress(user.id)

  return NextResponse.json({ success: true, message: 'Broadcast progress cleared. You can start a new broadcast.' })
}


export async function POST(request: NextRequest) {
  const user = await resolveBroadcastAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const clearFromQuery =
      request.nextUrl.searchParams.get('clear') === '1' ||
      request.nextUrl.searchParams.get('action') === 'clear'

    let body: { clear?: boolean; action?: string; message?: string } = {}
    try {
      body = await request.json()
    } catch {
      // Allow ?clear=1 with an empty POST body (some clients omit JSON).
    }

    const shouldClear = clearFromQuery || body?.clear === true || body?.action === 'clear'

    if (shouldClear) {
      await clearBroadcastProgress(user.id)
      return NextResponse.json({
        success: true,
        message: 'Broadcast progress cleared. You can start a new broadcast.',
      })
    }

    const { message } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const existingProgress = await prisma.systemConfig.findUnique({ where: { key: 'BROADCAST_PROGRESS' } })
    if (existingProgress?.value) {
      try {
        const parsed = JSON.parse(existingProgress.value) as { status?: string; lastUpdate?: string }
        const isActive = parsed.status === 'RUNNING' || parsed.status === 'WAITING_RATE_LIMIT'
        if (isActive) {
          const lastUpdate = parsed.lastUpdate ? new Date(parsed.lastUpdate).getTime() : 0
          const staleMs = Date.now() - lastUpdate
          const isStale = !lastUpdate || staleMs > 10 * 60 * 1000
          if (!isStale) {
            return NextResponse.json(
              { error: 'A broadcast is already in progress. Wait for it to finish or clear it first.' },
              { status: 409 }
            )
          }
        }
      } catch {
        // ignore malformed progress JSON
      }
    }

    const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
    const guildConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } })

    if (!tokenConfig?.value) {
      return NextResponse.json({ error: 'Discord Bot Token not configured' }, { status: 400 })
    }

    const DISCORD_BOT_TOKEN = tokenConfig.value;
    const DISCORD_GUILD_ID = guildConfig?.value;

    // 1. Get registered users (Discord IDs only — broadcast is DM-only)
    const registeredUsers = await prisma.user.findMany({
      where: { discordId: { not: '' } },
      select: { discordId: true },
    })

    let targetIds = new Set<string>(registeredUsers.map(u => u.discordId!))

    // 2. Get guild members if guild ID is configured
    if (DISCORD_GUILD_ID) {
      try {
        // This only gets 1000 members. For larger guilds, pagination is needed.
        const response = await axios.get(
          `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members?limit=1000`,
          { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
        )
        for (const member of response.data) {
          if (!member.user.bot) {
            targetIds.add(member.user.id)
          }
        }
      } catch (e: any) {
        console.error('[Broadcast] Failed to fetch guild members:', e.response?.data || e.message)
      }
    }

    const finalTargetIds = Array.from(targetIds)
    
    if (finalTargetIds.length === 0) {
      return NextResponse.json({ error: 'No targets found' }, { status: 400 })
    }

    // Since sending DMs can take a long time, we do it in the background
    // and return a response immediately.
    // However, in Vercel/Next.js edge, background tasks are tricky.
    // For now, we'll send them and return the status, but this might timeout if there are many users.
    // A better way would be a separate worker or a longer timeout.
    
    // Using a self-invoking async function to not block the response fully if possible
    // but Next.js might kill the process after response.
    // So we'll do a batch and return.
    
    const sendDMs = async () => {
      let success = 0;
      let fail = 0;
      let current = 0;
      
      const updateProgress = async (status: string) => {
        await prisma.systemConfig.upsert({
          where: { key: 'BROADCAST_PROGRESS' },
          update: { value: JSON.stringify({
            total: finalTargetIds.length,
            current,
            success,
            fail,
            status,
            lastUpdate: new Date().toISOString()
          }) },
          create: { key: 'BROADCAST_PROGRESS', value: JSON.stringify({
            total: finalTargetIds.length,
            current,
            success,
            fail,
            status,
            lastUpdate: new Date().toISOString()
          }) }
        })
      }

      await updateProgress('RUNNING');
      
      for (let i = 0; i < finalTargetIds.length; i++) {
        const id = finalTargetIds[i];
        current = i + 1;
        
        let attempts = 0;
        let sent = false;
        
        while (attempts < 3 && !sent) {
          try {
            // Create DM channel
            const dmChannel = await axios.post(
              `https://discord.com/api/v10/users/@me/channels`,
              { recipient_id: id },
              { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
            )
            
            // Send message
            await axios.post(
              `https://discord.com/api/v10/channels/${dmChannel.data.id}/messages`,
              {
                embeds: [{
                  title: '📣 Important Update / Announcement',
                  description: message,
                  color: 0x3b82f6,
                  timestamp: new Date().toISOString(),
                  footer: { text: 'OpenSteam Network Broadcast' }
                }]
              },
              { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
            )
            
            success++;
            sent = true;
          } catch (e: any) {
            if (e.response?.status === 429) {
              const retryAfter = (parseInt(e.response.headers['retry-after']) || 5) * 1000;
              console.log(`[Broadcast] Rate limited. Waiting ${retryAfter}ms...`);
              await updateProgress('WAITING_RATE_LIMIT');
              await new Promise(r => setTimeout(r, retryAfter + 1000));
              attempts++;
              await updateProgress('RUNNING');
            } else {
              console.error(`[Broadcast] Failed to send to ${id}:`, e.response?.data || e.message);
              fail++;
              break; // Give up on this user
            }
          }
        }
        
        if (current % 5 === 0 || current === finalTargetIds.length) {
          await updateProgress('RUNNING');
        }
        
        // Base delay
        await new Promise(r => setTimeout(r, 300));
      }
      
      await updateProgress('COMPLETED');
      console.log(`[Broadcast] Completed. Success: ${success}, Fail: ${fail}`);
    }

    // Fire-and-forget background task. It MUST NOT throw an unhandled rejection,
    // otherwise Node 22 terminates the whole server process (causing 502s on
    // every route until the container restarts).
    void sendDMs().catch(async (err: any) => {
      console.error('[Broadcast] Background task failed:', err?.response?.data || err?.message || err)
      try {
        await prisma.systemConfig.upsert({
          where: { key: 'BROADCAST_PROGRESS' },
          update: {
            value: JSON.stringify({
              status: 'FAILED',
              error: String(err?.message || err),
              lastUpdate: new Date().toISOString(),
            }),
          },
          create: {
            key: 'BROADCAST_PROGRESS',
            value: JSON.stringify({ status: 'FAILED', lastUpdate: new Date().toISOString() }),
          },
        })
      } catch (progressErr) {
        console.error('[Broadcast] Failed to record FAILED progress:', progressErr)
      }
    })

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'BOT_BROADCAST',
        details: `Started self-adv broadcast to ${finalTargetIds.length} users. Message: ${message.substring(0, 100)}...`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ 
      success: true, 
      message: `Broadcast started to ${finalTargetIds.length} potential targets.` 
    })

  } catch (error: any) {
    console.error('[Broadcast Error]', error.response?.data || error.message)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
