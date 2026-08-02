import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';

/**
 * POST /api/forge/scripts/[id]/star
 * Toggle visibility of a star for an extension script.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scriptId = params.id;
  const userId = (session.user as any).id;

  try {
    // Check if script exists
    const script = await (prisma as any).extensionScript.findUnique({
      where: { id: scriptId }
    });

    if (!script) {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }

    // Check if user already starred
    const existingStar = await (prisma as any).scriptStar.findUnique({
      where: {
        userId_scriptId: { userId, scriptId }
      }
    });

    if (existingStar) {
      // Un-star
      await (prisma as any).$transaction([
        (prisma as any).scriptStar.delete({
          where: { id: existingStar.id }
        }),
        (prisma as any).extensionScript.update({
          where: { id: scriptId },
          data: { starCount: { decrement: 1 } }
        })
      ]);
      return NextResponse.json({ starred: false, count: script.starCount - 1 });
    } else {
      // Star
      await (prisma as any).$transaction([
        (prisma as any).scriptStar.create({
          data: { userId, scriptId }
        }),
        (prisma as any).extensionScript.update({
          where: { id: scriptId },
          data: { starCount: { increment: 1 } }
        })
      ]);
      return NextResponse.json({ starred: true, count: script.starCount + 1 });
    }
  } catch (error) {
    console.error('Forge star toggle error:', error);
    return NextResponse.json({ error: 'Failed to toggle star' }, { status: 500 });
  }
}
