import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { writeUserData } from '@/app/lib/storage';

/**
 * GET /api/forge/profiles
 * List manifest profiles for the current user.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const profiles = await (prisma as any).manifestProfile.findMany({
      where: { userId: (session.user as any).id },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ profiles });
  } catch (error) {
    console.error('Forge profiles fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 });
  }
}

/**
 * POST /api/forge/profiles
 * Create a new manifest profile.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { name, description, config } = body;

    if (!name || !config) {
      return NextResponse.json({ error: 'Name and config are required' }, { status: 400 });
    }

    // Validate config is valid JSON
    try {
      JSON.parse(config);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON configuration' }, { status: 400 });
    }

    const profile = await (prisma as any).manifestProfile.create({
      data: {
        name,
        description,
        config,
        userId: (session.user as any).id,
      }
    });

    // Save copy to local volume (/data)
    writeUserData(`${profile.id}.json`, config, 'profiles')

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Forge profile creation error:', error);
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }
}
