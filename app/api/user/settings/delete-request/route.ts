import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { sendAccountDeletionAuthCodeEmail } from '@/app/lib/email';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const userId = (session.user as any).id;
    
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await prisma.user.update({
      where: { id: userId },
      data: {
        deleteAuthCode: code,
        deleteAuthCodeExpires: expires
      }
    });

    await sendAccountDeletionAuthCodeEmail(userId, code);

    return NextResponse.json({ success: true, message: 'Authorization code sent to your email.' });
  } catch (err) {
    console.error('Delete request error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
