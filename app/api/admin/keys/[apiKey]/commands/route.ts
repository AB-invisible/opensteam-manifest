import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey } from '@/app/lib/auth'

/**
 * PUT /api/admin/keys/[apiKey]/commands
 * 
 * Sets admin commands for a specific API key.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { apiKey: string } }
) {
  try {
    const { apiKey: targetKeyString } = params

    // 1. Authenticate (Session or API Key)
    let user = null
    const auth = await authenticateApiKey(request, { skipUsage: true })
    
    if (auth) {
      user = auth.user
    } else {
      const { getServerSession } = await import('next-auth')
      const { authOptions } = await import('@/app/lib/auth-options')
      const session = await getServerSession(authOptions)
      if (session?.user) {
        user = await prisma.user.findUnique({
          where: { discordId: session.user.discordId as string }
        })
      }
    }

    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }


    // 2. Validate Body
    const body = await request.json()
    const { disable, forceUpdate } = body

    if (typeof disable !== 'boolean' || typeof forceUpdate !== 'boolean') {
      return NextResponse.json({ error: 'Invalid command payload' }, { status: 400 })
    }

    // 3. Update Key
    const updatedKey = await prisma.apiKey.update({
      where: { key: targetKeyString },
      data: {
        adminDisable: disable,
        adminForceUpdate: forceUpdate
      }
    })

    // 4. Count Affected Sessions
    const affectedSessions = await prisma.appSession.count({
      where: { apiKeyId: updatedKey.id }
    })

    return NextResponse.json({
      apiKey: updatedKey.key,
      commands: {
        disable: updatedKey.adminDisable,
        forceUpdate: updatedKey.adminForceUpdate
      },
      affectedSessions
    })

  } catch (error) {
    console.error('[/api/admin/keys/[apiKey]/commands] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/keys/[apiKey]/commands
 * 
 * Clears admin commands for a specific API key.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { apiKey: string } }
) {
  try {
    const { apiKey: targetKeyString } = params

    // 1. Authenticate (Session or API Key)
    let user = null
    const auth = await authenticateApiKey(request, { skipUsage: true })
    
    if (auth) {
      user = auth.user
    } else {
      const { getServerSession } = await import('next-auth')
      const { authOptions } = await import('@/app/lib/auth-options')
      const session = await getServerSession(authOptions)
      if (session?.user) {
        user = await prisma.user.findUnique({
          where: { discordId: session.user.discordId as string }
        })
      }
    }

    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }


    // 2. Clear Commands
    await prisma.apiKey.update({
      where: { key: targetKeyString },
      data: {
        adminDisable: false,
        adminForceUpdate: false
      }
    })

    return NextResponse.json({ ok: true })

  } catch (error) {
    console.error('[/api/admin/keys/[apiKey]/commands] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
