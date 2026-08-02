import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { sendSelfSuspensionEmail } from '@/app/lib/email';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const userId = (session.user as any).id;
    
    await prisma.user.update({
      where: { id: userId },
      data: { isSelfSuspended: true }
    });

    // Send email/DM
    await sendSelfSuspensionEmail(userId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Suspend account error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
