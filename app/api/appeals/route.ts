import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { userId, reason } = await req.json();
    if (!userId || !reason) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Check if there is already an active pending appeal (APPEAL_SUBMITTED)
    const activeAppeal = await prisma.sentinelLog.findFirst({
      where: {
        userId,
        action: 'APPEAL_SUBMITTED'
      }
    });
    if (activeAppeal) {
      return NextResponse.json({ error: 'You already have an active pending appeal.' }, { status: 400 });
    }

    // Store the appeal as a SentinelLog entry
    await prisma.sentinelLog.create({
      data: {
        userId,
        action: 'APPEAL_SUBMITTED',
        score: 0,
        reason: 'User submitted a ban/suspension appeal',
        details: JSON.stringify({ reason })
      }
    });

    // Alert admins via Webhook
    const alertChannelCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_ALERTS_CHANNEL_ID' } });
    const botTokenCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
    
    if (alertChannelCfg?.value && botTokenCfg?.value) {
      try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        await fetch(`https://discord.com/api/v10/channels/${alertChannelCfg.value}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${botTokenCfg.value}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            embeds: [{
              title: '📝 New Ban Appeal',
              description: `**User:** ${user.username} (<@${user.discordId}>)\n**Type:** ${user.isBanned ? 'Permanent Ban' : 'Temporary Suspension'}\n\n**Reason Provided:**\n${reason}`,
              color: 0xf59e0b, // Orange warning color
              timestamp: new Date().toISOString(),
              footer: { text: 'OpenSteam Moderation System' }
            }]
          })
        });
      } catch (e) {
        console.error('[Appeal Discord Alert Error]', e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Appeal API Error]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
