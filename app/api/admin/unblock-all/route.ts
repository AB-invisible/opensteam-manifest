import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { verifyAdminApiKeyFromRequest } from '@/app/lib/admin-api-key'

/**
 * GET /api/admin/unblock-all
 * 
 * EMERGENCY UTILITY: Clears all system-wide blocks, IP blacklists, and jails.
 * Requires ADMIN_API_KEY for security.
 */
export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  if (!verifyAdminApiKeyFromRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }

  try {
    console.log('[Emergency] Running system-wide unblock sequence...');

    // 1. Clear IP Blacklist
    const deletedBlacklist = await prisma.blacklistedIp.deleteMany({});

    // 2. Reset jail status and risk scores for all users
    const resetUsers = await prisma.user.updateMany({
      data: {
        jailLevel: 0,
        jailUntil: null,
        riskScore: 0,
        isBanned: false
      } as any
    });

    // 3. Clear all Rate Limit States (temporary hourly/IP jails)
    const deletedStates = await (prisma as any).rateLimitState.deleteMany({});

    return NextResponse.json({
      success: true,
      message: 'System-wide unblocking complete.',
      details: {
        ipsRemoved: deletedBlacklist.count,
        usersReset: resetUsers.count,
        statesCleared: deletedStates.count
      }
    }, { headers })

  } catch (error: any) {
    console.error('[Emergency Error]', error)
    return NextResponse.json({ 
        success: false, 
        error: error.message 
    }, { status: 500, headers })
  }
}
