import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { requireModeratorPlusFromDb } from '@/app/lib/route-guards'

export async function GET(request: NextRequest) {
  const staffResult = await requireModeratorPlusFromDb()
  if ('error' in staffResult) return staffResult.error

  try {
    const donations = await prisma.keyDonation.findMany({
      include: {
        user: {
          select: {
            username: true,
            discordId: true,
            avatar: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ donations })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch donations' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const staffResult = await requireModeratorPlusFromDb()
  if ('error' in staffResult) return staffResult.error

  try {
    const { id, status, notes } = await request.json()

    const { approveDonation, rejectDonation } = await import('@/app/lib/bot-admin')

    if (status === 'APPROVED') {
      const result = await approveDonation(id)
      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 400 })
      }
      if (notes) {
        await prisma.keyDonation.update({ where: { id }, data: { notes } })
      }
      const donation = await prisma.keyDonation.findUnique({
        where: { id },
        include: { user: { select: { username: true, discordId: true, avatar: true } } },
      })
      return NextResponse.json({ success: true, donation })
    }

    if (status === 'REJECTED') {
      const result = await rejectDonation(id)
      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 400 })
      }
      if (notes) {
        await prisma.keyDonation.update({ where: { id }, data: { notes } })
      }
      const donation = await prisma.keyDonation.findUnique({
        where: { id },
        include: { user: { select: { username: true, discordId: true, avatar: true } } },
      })
      return NextResponse.json({ success: true, donation })
    }

    const donation = await prisma.keyDonation.update({
      where: { id },
      data: { status, notes },
      include: { user: { select: { username: true, discordId: true, avatar: true } } },
    })

    return NextResponse.json({ success: true, donation })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update donation' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const staffResult = await requireModeratorPlusFromDb()
  if ('error' in staffResult) return staffResult.error

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 })

  try {
    await prisma.keyDonation.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete donation' }, { status: 500 })
  }
}
