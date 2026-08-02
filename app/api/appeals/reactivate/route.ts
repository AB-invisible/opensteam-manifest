import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isBanned: true, jailUntil: true }
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Check if there is an accepted appeal for this user (APPEAL_ACCEPTED)
    const acceptedAppeal = await prisma.sentinelLog.findFirst({
      where: {
        userId: user.id,
        action: 'APPEAL_ACCEPTED'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!acceptedAppeal) {
      return NextResponse.json({ error: 'No accepted appeal found for this user.' }, { status: 400 });
    }

    // Call the unban globally function to restore account & IP
    const { unbanUserGlobally } = await import('@/app/lib/ratelimit');
    await unbanUserGlobally(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Reactivate API Error]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
