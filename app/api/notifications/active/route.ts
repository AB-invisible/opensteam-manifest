import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

export async function GET(request: NextRequest) {
  // Define local CORS headers to avoid dependency on heavy auth modules
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
  }
  
  try {
    // 1. Check if prisma is available (safety check)
    if (!prisma.systemNotification) {
        throw new Error('Prisma Client not initialized with systemNotification model')
    }

    const activeNotification = await prisma.systemNotification.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
      take: 1
    })

    return NextResponse.json({
      success: true,
      notification: activeNotification || null
    }, { 
      status: 200,
      headers: corsHeaders 
    })

  } catch (error: any) {
    console.error('[API Active Notification Error]', error)
    return NextResponse.json({ 
        success: false, 
        error: error.message || 'Internal Server Error'
    }, { 
      status: 500, 
      headers: corsHeaders 
    })
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
        }
    })
}
