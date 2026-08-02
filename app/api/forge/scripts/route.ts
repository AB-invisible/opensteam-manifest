import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { writeUserData } from '@/app/lib/storage';
import { moderateScript } from '@/app/lib/moderator';

/**
 * GET /api/forge/scripts
 * List extension scripts. Supports filtering by 'type' (my, public).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'my';

  try {
    const where: any = {};
    if (type === 'my') {
      where.authorId = (session.user as any).id;
    } else if (type === 'public') {
      where.isPublic = true;
      where.moderationStatus = 'APPROVED';
    }

    const scripts = await prisma.extensionScript.findMany({
      where,
      include: {
        author: {
          select: {
            username: true,
            avatar: true,
            discordId: true,
          }
        },
        stars: {
          where: { userId: (session.user as any).id },
          select: { id: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Map to include a simple boolean for UI
    const processedScripts = scripts.map((s: any) => ({
      ...s,
      isStarred: s.stars.length > 0,
      stars: undefined // Remove the relation array from output
    }));

    return NextResponse.json({ scripts: processedScripts });
  } catch (error) {
    console.error('Forge scripts fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch scripts' }, { status: 500 });
  }
}

/**
 * POST /api/forge/scripts
 * Create a new extension script.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { name, description, content, isPublic, language } = body;

    if (!name || !content) {
      return NextResponse.json({ error: 'Name and content are required' }, { status: 400 });
    }

    const moderation = await moderateScript(content);
    if (moderation.status === 'REJECTED') {
      return NextResponse.json({ error: moderation.reason }, { status: 400 });
    }

    const wantsPublic = !!isPublic;
    const moderationStatus = moderation.status === 'PENDING' ? 'PENDING' : 'APPROVED';
    const effectivePublic = wantsPublic && moderationStatus === 'APPROVED';

    const script = await prisma.extensionScript.create({
      data: {
        name,
        description,
        content,
        language: language || 'javascript',
        isPublic: effectivePublic,
        moderationStatus,
        moderationReason: moderation.reason,
        authorId: (session.user as any).id,
      }
    });

    // Save copy to local volume (/data) for persistent user-data storage
    writeUserData(`${script.id}.js`, content, 'scripts')

    await prisma.auditLog.create({
      data: {
        userId: (session.user as any).id,
        action: 'FORGE_SCRIPT_MODERATED',
        targetId: script.id,
        details: JSON.stringify({
          name,
          moderationStatus,
          reason: moderation.reason,
          requestedPublic: wantsPublic,
        }),
        ip: '127.0.0.1',
      },
    }).catch(() => {})

    return NextResponse.json({
      script,
      moderation: { status: moderationStatus, reason: moderation.reason },
    });
  } catch (error) {
    console.error('Forge script creation error:', error);
    return NextResponse.json({ error: 'Failed to create script' }, { status: 500 });
  }
}
