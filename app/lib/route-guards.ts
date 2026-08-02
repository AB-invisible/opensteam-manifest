import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { isModeratorPlus } from '@/app/lib/staff-roles';
import type { User } from '@prisma/client';

export type SessionUser = {
  email?: string | null;
  role?: string;
  discordId?: string;
  id?: string;
};

export async function requireSession(): Promise<
  { user: SessionUser } | { error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user: session.user as SessionUser };
}

export async function requireDbUser(): Promise<
  { user: User } | { error: NextResponse }
> {
  const sessionResult = await requireSession();
  if ('error' in sessionResult) return sessionResult;

  const discordId = sessionResult.user.discordId;
  if (!discordId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({ where: { discordId } });
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { user };
}

export async function requireAdminFromDb(): Promise<
  { user: User } | { error: NextResponse }
> {
  const dbUserResult = await requireDbUser();
  if ('error' in dbUserResult) return dbUserResult;

  if (!['ADMIN', 'OWNER'].includes(dbUserResult.user.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return dbUserResult;
}

export async function requireModeratorPlusFromDb(): Promise<
  { user: User } | { error: NextResponse }
> {
  const dbUserResult = await requireDbUser();
  if ('error' in dbUserResult) return dbUserResult;

  if (!isModeratorPlus(dbUserResult.user.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return dbUserResult;
}

export async function requireOwnerFromDb(): Promise<
  { user: User } | { error: NextResponse }
> {
  const dbUserResult = await requireDbUser();
  if ('error' in dbUserResult) return dbUserResult;

  if (dbUserResult.user.role !== 'OWNER') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return dbUserResult;
}

export function canAccessSupportTicket(
  session: SessionUser,
  ticket: { fromEmail: string }
): boolean {
  if (!session.email) return false;
  if (ticket.fromEmail === session.email) return true;
  return isModeratorPlus(session.role);
}
