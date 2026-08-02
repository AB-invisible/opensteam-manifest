import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const userId = (session.user as any).id

  try {
    const donations = await prisma.keyDonation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        gameName: true,
        steamKey: true,
        status: true,
        notes: true,
        createdAt: true
      }
    })

    // Mask keys for users unless they are pending? 
    // Actually, it's their own keys, but masking is safer.
    const maskedDonations = donations.map(d => ({
      ...d,
      steamKey: d.steamKey.substring(0, 4) + '••••' + d.steamKey.slice(-4)
    }))

    return NextResponse.json({ donations: maskedDonations })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch donation history' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const userId = (session.user as any).id

  try {
    const { gameName, steamKey } = await request.json()

    if (!gameName || !steamKey) {
      return NextResponse.json({ error: 'Missing game name or steam key' }, { status: 400 })
    }

    // Submit to DB
    const donation = await prisma.keyDonation.create({
      data: {
        userId,
        gameName,
        steamKey,
        status: 'PENDING'
      }
    })

    // Notify staff via Discord (using existing bot integration)
    try {
      await fetch(`${process.env.NEXTAUTH_URL}/api/bots/discord/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'notify_donation',
          donationId: donation.id,
          userId,
          gameName,
          steamKey
        })
      })
    } catch (e) {
      // Just log, don't fail the user request
      console.error('Failed to notify staff:', e)
    }

    return NextResponse.json({ success: true, donationId: donation.id })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to submit donation' }, { status: 500 })
  }
}
