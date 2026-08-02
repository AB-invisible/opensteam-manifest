import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { verifyAdminApiKeyFromRequest } from '@/app/lib/admin-api-key'
import { requireAdminFromDb } from '@/app/lib/route-guards'

/**
 * POST /api/admin/notifications
 * 
 * Set a new system-wide alert and broadcast to Standard+ users.
 */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  // 1. Authenticate (Session or Key)
  const isKeyAdmin = verifyAdminApiKeyFromRequest(request)
  const adminResult = await requireAdminFromDb()
  const isSessionAdmin = !('error' in adminResult)

  if (!isKeyAdmin && !isSessionAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }

  try {
    const { title, message, description, type, active, broadcast } = await request.json()

    // 3. Special Case: Deactivate all alerts
    if (active === false) {
      await prisma.systemNotification.updateMany({
        where: { active: true },
        data: { active: false }
      })
      return NextResponse.json({ success: true, message: 'All alerts deactivated.' }, { headers })
    }

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400, headers })
    }

    // If requested or if the issue is 'error' level, trigger Discord DMs
    if (broadcast || type === 'error') {
      const { setSystemNotification } = await import('@/app/lib/notifications')
      // Note: setSystemNotification handles marking others inactive and the broadcast logic
      await setSystemNotification({ title, message, description, type: type || 'warning', active: true })
      
      return NextResponse.json({
        success: true,
        message: 'Alert published and broadcast initiated.'
      }, { headers })
    }

    // Normal path (no broadcast)
    await prisma.systemNotification.updateMany({
      where: { active: true },
      data: { active: false }
    })

    const notification = await prisma.systemNotification.create({
      data: {
        title,
        message,
        description,
        type: type || 'warning',
        active: active !== undefined ? active : true
      }
    })

    return NextResponse.json({
      success: true,
      notification
    }, { headers })

  } catch (error: any) {
    console.error('[API Admin Notification Error]', error)
    return NextResponse.json({ 
        success: false, 
        error: error.message 
    }, { status: 500, headers })
  }
}

/**
 * GET /api/admin/notifications
 * 
 * Get history of notifications.
 */
export async function GET(request: NextRequest) {
    const headers = corsHeaders(request.headers.get('Origin'))
    
    // 1. Authenticate (Session or Key)
    const isKeyAdmin = verifyAdminApiKeyFromRequest(request)
    const adminResult = await requireAdminFromDb()
    const isSessionAdmin = !('error' in adminResult)

    if (!isKeyAdmin && !isSessionAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }
  
    try {
      const history = await prisma.systemNotification.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20
      })
  
      return NextResponse.json({
        success: true,
        history
      }, { headers })
  
    } catch (error: any) {
      console.error('[API Admin Notification List Error]', error)
      return NextResponse.json({ 
          success: false, 
          error: error.message 
      }, { status: 500, headers })
    }
  }
