import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const donations = await prisma.keyDonation.findMany({
      where: { status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 20, // Only show last 20 for feed
      select: {
        id: true,
        gameName: true,
        createdAt: true,
        user: {
          select: {
            username: true,
            avatar: true,
            discordId: true,
          }
        }
      }
    })

    return NextResponse.json({ donations })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch public donations' }, { status: 500 })
  }
}
