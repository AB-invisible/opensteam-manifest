import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { ensureUserAntiPhishingCode, regenerateUserAntiPhishingCode } from '@/app/lib/anti-phishing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discordId = (session.user as { discordId?: string }).discordId;
  if (!discordId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true, antiPhishingCode: true, antiPhishingIntroSeenAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const code = await ensureUserAntiPhishingCode(user.id);

  return NextResponse.json({
    code,
    introSeen: Boolean(user.antiPhishingIntroSeenAt),
  });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discordId = (session.user as { discordId?: string }).discordId;
  if (!discordId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const code = await ensureUserAntiPhishingCode(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { antiPhishingIntroSeenAt: new Date() },
  });

  return NextResponse.json({ success: true, code });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discordId = (session.user as { discordId?: string }).discordId;
  if (!discordId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let body: { regenerate?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (!body.regenerate) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const code = await regenerateUserAntiPhishingCode(user.id);

  return NextResponse.json({ success: true, code });
}
