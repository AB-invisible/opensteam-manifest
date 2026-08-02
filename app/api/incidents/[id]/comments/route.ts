import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

/**
 * GET /api/incidents/[id]/comments
 * Fetch all comments for an incident.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const comments = await prisma.comment.findMany({
      where: { incidentId: params.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: { username: true, avatar: true, role: true, discordId: true }
        }
      }
    })
    return NextResponse.json({ success: true, comments }, { headers: corsHeaders })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders })
  }
}

/**

 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    // Only ADMIN or MODERATOR can post comments
    const role = (session?.user as any)?.role
    const isStaff = role === 'ADMIN' || role === 'MODERATOR' || role === 'OWNER';
    if (!session?.user || !isStaff) {
      return NextResponse.json(
        { success: false, error: 'Only staff members can post updates on incidents.' },
        { status: 401, headers: corsHeaders }
      )
    }

    const body = await req.json()
    const { content, status } = body

    if (!content || !content.trim()) {
      return NextResponse.json({ success: false, error: 'Comment cannot be empty.' }, { status: 400, headers: corsHeaders })
    }
    if (content.trim().length > 500) {
      return NextResponse.json({ success: false, error: 'Comment is too long (max 500 chars).' }, { status: 400, headers: corsHeaders })
    }

    // Verify incident exists
    const incident = await prisma.systemNotification.findUnique({ where: { id: params.id } })
    if (!incident) {
      return NextResponse.json({ success: false, error: 'Incident not found.' }, { status: 404, headers: corsHeaders })
    }

    const comment = await prisma.comment.create({
      data: {
        incidentId: params.id,
        userId: (session?.user as any)?.id ?? null,
        username: (session?.user as any)?.name ?? 'Anonymous',
        content: content.trim(),
        status: status ?? null, // 'resolved' | 'ongoing' | null
      },
      include: {
        user: { select: { username: true, avatar: true, role: true, discordId: true } }
      }
    })

    return NextResponse.json({ success: true, comment }, { headers: corsHeaders })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders })
  }
}
