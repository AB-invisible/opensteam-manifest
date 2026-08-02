import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/**
 * GET /api/notifications/history
 * Public endpoint to fetch the history of platform alerts.
 */
export async function GET(_request: NextRequest) {
  
  try {
    const history = await prisma.systemNotification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50 // Show the last 50 historical entries
    })

    return NextResponse.json({
      success: true,
      history
    }, { headers: corsHeaders })

  } catch (error: any) {
    console.error('[API Notification History Error]', error)
    return NextResponse.json({ 
        success: false, 
        error: error.message 
    }, { status: 500, headers: corsHeaders })
  }
}
