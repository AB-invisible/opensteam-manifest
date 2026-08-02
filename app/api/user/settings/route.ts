import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';

import { ensureUserAntiPhishingCode } from '@/app/lib/anti-phishing';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const userId = (session.user as { id?: string }).id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        notifyEmail: true,
        notifyDm: true,
        isSelfSuspended: true,
        antiPhishingCode: true,
      }
    });

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const antiPhishingCode = await ensureUserAntiPhishingCode(userId);

    return NextResponse.json({
      user: {
        notifyEmail: user.notifyEmail,
        notifyDm: user.notifyDm,
        isSelfSuspended: user.isSelfSuspended,
        antiPhishingCode,
      },
    });
  } catch (err) {
    console.error('Fetch settings error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { notifyEmail, notifyDm } = body;
    
    if (typeof notifyEmail !== 'boolean' && typeof notifyDm !== 'boolean') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const data: any = {};
    if (typeof notifyEmail === 'boolean') data.notifyEmail = notifyEmail;
    if (typeof notifyDm === 'boolean') data.notifyDm = notifyDm;

    const user = await prisma.user.update({
      where: { id: (session.user as any).id },
      data,
      select: { notifyEmail: true, notifyDm: true }
    });

    return NextResponse.json({ user });
  } catch (err) {
    console.error('Update settings error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
