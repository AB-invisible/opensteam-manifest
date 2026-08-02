import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = await prisma.user.findUnique({ where: { discordId: session.user.discordId } });
  if (!admin || (admin.role !== 'OWNER' && admin.role !== 'ADMIN' && admin.role !== 'SENIOR_MODERATOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch all appeals (PENDING, ACCEPTED, DECLINED)
  const appeals = await prisma.sentinelLog.findMany({
    where: {
      action: { in: ['APPEAL_SUBMITTED', 'APPEAL_ACCEPTED', 'APPEAL_DECLINED'] }
    },
    include: {
      user: {
        select: { id: true, username: true, email: true, discordId: true, isBanned: true, jailUntil: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return NextResponse.json({ appeals });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = await prisma.user.findUnique({ where: { discordId: session.user.discordId } });
  if (!admin || (admin.role !== 'OWNER' && admin.role !== 'ADMIN' && admin.role !== 'SENIOR_MODERATOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { logId, actionType } = await request.json(); // actionType: 'ACCEPT' or 'DECLINE'
  
  const log = await prisma.sentinelLog.findUnique({ where: { id: logId } });
  if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!log.userId) return NextResponse.json({ error: 'Invalid log record' }, { status: 400 });

  const newAction = actionType === 'ACCEPT' ? 'APPEAL_ACCEPTED' : 'APPEAL_DECLINED';

  // Update the log status
  await prisma.sentinelLog.update({
    where: { id: logId },
    data: { action: newAction }
  });

  // If accepted, unban the user
  if (actionType === 'ACCEPT') {
    const { unbanUserGlobally } = await import('@/app/lib/ratelimit');
    await unbanUserGlobally(log.userId);

    // Optionally DM and Email the user
    try {
      const user = await prisma.user.findUnique({ where: { id: log.userId } });
      const { sendBotDM } = await import('@/app/lib/bot-admin');
      const { sendBrandedEmail } = await import('@/app/lib/email');
      
      if (user?.discordId) {
        await sendBotDM(user.discordId, '', {
          title: '✅ Appeal Accepted',
          description: 'Your appeal has been reviewed and accepted. Your OpenSteam account and API keys have been fully restored.',
          color: 0x10b981
        });
      }

      if (user?.email) {
        await sendBrandedEmail(
          user.email,
          'Appeal Accepted - OpenSteam',
          '✅ Appeal Accepted',
          'Your appeal has been reviewed and accepted. Your OpenSteam account and API keys have been fully restored.',
          '#10b981'
        );
      }
    } catch(e) {}
  } else {
    // If declined, optionally DM and Email the user
    try {
      const user = await prisma.user.findUnique({ where: { id: log.userId } });
      const { sendBotDM } = await import('@/app/lib/bot-admin');
      const { sendBrandedEmail } = await import('@/app/lib/email');

      if (user?.discordId) {
        await sendBotDM(user.discordId, '', {
          title: '❌ Appeal Declined',
          description: 'Your appeal has been reviewed and declined. Your punishment remains active.',
          color: 0xef4444
        });
      }

      if (user?.email) {
        await sendBrandedEmail(
          user.email,
          'Appeal Declined - OpenSteam',
          '❌ Appeal Declined',
          'Your appeal has been reviewed and declined. Your punishment remains active. You may not appeal again for this specific action.',
          '#ef4444'
        );
      }
    } catch(e) {}
  }

  return NextResponse.json({ success: true });
}
