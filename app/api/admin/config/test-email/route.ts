
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { sendBrandedEmail } from '@/app/lib/email';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  });

  if (!user || user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const success = await sendBrandedEmail(
      'pokemgo300@gmail.com',
      'System Configuration Test - OpenSteam',
      '🛠️ Email System Test',
      `This is an automated test to verify that your email configuration (Resend/SMTP) is working correctly.\n\n**Triggered by:** ${user.username}\n**Timestamp:** ${new Date().toLocaleString()}`,
      '#6366f1'
    );

    if (success) {
      return NextResponse.json({ success: true, message: 'Test email sent to pokemgo300@gmail.com' });
    } else {
      return NextResponse.json({ error: 'Failed to send email. Check server logs.' }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
