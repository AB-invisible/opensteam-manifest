import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { authOptions } from '@/app/lib/auth-options'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
    if (!user || user.role !== 'OWNER') return NextResponse.json({ error: 'Access Denied' }, { status: 403 })

    const keys = await prisma.apiKey.findMany({
      include: {
        user: { select: { username: true, discriminator: true, avatar: true, discordId: true, plan: true } },
        appSessions: {
          orderBy: { lastSeen: 'desc' },
          take: 1
        },
        _count: { select: { usage: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    const creationConfig = await prisma.systemConfig.findUnique({ where: { key: 'KEYS_CREATION_ENABLED' } })
    const creationEnabled = creationConfig ? creationConfig.value === 'true' : true

    return NextResponse.json({ keys, creationEnabled })
  } catch (error) {
    console.error('Error fetching admin keys:', error)
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminUser = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
    if (!adminUser || adminUser.role !== 'OWNER') return NextResponse.json({ error: 'Access Denied' }, { status: 403 })

    const { keyId } = await request.json()
    
    const keyToDelete = await prisma.apiKey.findUnique({
      where: { id: keyId },
      include: { user: true }
    })

    if (!keyToDelete) return NextResponse.json({ error: 'API Key not found' }, { status: 404 })

    await prisma.apiKey.delete({
      where: { id: keyId }
    })

    // DM & Email User
    if (keyToDelete.user) {
      const { sendBotDM } = await import('@/app/lib/bot-admin');
      const { sendEmail } = await import('@/app/lib/email');

      const msg = '';
      const embed = {
        title: '⚠️ API Key Deleted',
        description: `Your API Key **${keyToDelete.name}** was deleted by an administrator.`,
        color: 0xdc2626,
        timestamp: new Date().toISOString(),
        footer: { text: 'OpenSteam Network Security' }
      };
      
      if (keyToDelete.user.discordId) {
        await sendBotDM(keyToDelete.user.discordId, msg, embed);
      }

      if (keyToDelete.user.email) {
        const { sendBrandedEmail } = await import('@/app/lib/email');
        await sendBrandedEmail(
          keyToDelete.user.email,
          'API Key Deleted by Administrator — OpenSteam',
          '🗑️ API Key Deleted',
          `Hello <strong>${keyToDelete.user.username}</strong>,<br><br>Your API key <strong>${keyToDelete.name}</strong> has been deleted by a OpenSteam administrator.<br><br>All active sessions using this key have been immediately terminated. If you believe this was done in error, please contact our support team.`,
          '#dc2626',
          undefined,
          {
            buttonText: 'Contact Support',
            buttonUrl: 'http://127.0.0.1:3000/support',
            securityNotice: 'This action was performed by a OpenSteam administrator. If you did not expect this, please reach out to our support team immediately.',
          }
        ).catch(() => {});
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete user API key' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminUser = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
    if (!adminUser || adminUser.role !== 'OWNER') return NextResponse.json({ error: 'Access Denied' }, { status: 403 })

    const { keyId, enabled } = await request.json()

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { enabled }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update user API key' }, { status: 500 })
  }
}
