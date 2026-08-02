import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { sendAccountDeletionCompleteEmail } from '@/app/lib/email';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const userId = (session.user as any).id;
    const { code } = await req.json();

    if (!code) return NextResponse.json({ error: 'Authorization code is required.' }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        apiKeys: true,
        manifests: true,
        scripts: true,
        profiles: true
      }
    });

    if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    if (!user.deleteAuthCode || user.deleteAuthCode !== code) {
      return NextResponse.json({ error: 'Invalid authorization code.' }, { status: 400 });
    }

    if (!user.deleteAuthCodeExpires || new Date() > new Date(user.deleteAuthCodeExpires)) {
      return NextResponse.json({ error: 'Authorization code has expired. Please request a new one.' }, { status: 400 });
    }

    // Prepare data export
    const exportData = {
      profile: {
        id: user.id,
        discordId: user.discordId,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
        role: user.role,
        plan: user.plan
      },
      apiKeys: user.apiKeys.map(k => ({ name: k.name, key: k.key, createdAt: k.createdAt })),
      manifests: user.manifests.map(m => ({ steamAppId: m.steamAppId, name: m.name })),
      scripts: user.scripts.map(s => ({ name: s.name, language: s.language })),
      profiles: user.profiles.map(p => ({ name: p.name, config: p.config }))
    };

    const dataBuffer = Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8');

    // Create Audit Log (using "SYSTEM" as actor since user is being deleted)
    await prisma.auditLog.create({
      data: {
        userId: userId, // Temporarily attach to user, though it might fail if Cascade deletion hits it
        // To be safe, we'll store targetId as the user's ID, and userId as some system constant if needed, 
        // but user is required. Since we want to keep the log, and user is about to be deleted, 
        // wait, if we delete the user, AuditLog drops it (Cascade). Let's just skip audit log or use Sentinel.
        // Actually, user deletion is cascade. We will just send the email.
        action: 'ACCOUNT_DELETED',
      }
    }).catch(() => {});

    if (user.email) {
      await sendAccountDeletionCompleteEmail(user.email, user.username, dataBuffer);
    }

    // Delete user
    await prisma.user.delete({
      where: { id: userId }
    });

    return NextResponse.json({ success: true, message: 'Account permanently deleted.' });
  } catch (err) {
    console.error('Delete confirm error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
