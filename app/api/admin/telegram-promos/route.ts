import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'

// Ensure only admins can access
async function checkAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !session.user) return false
  
  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { role: true }
  })
  return user?.role === 'ADMIN' || user?.role === 'OWNER'
}

export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const promos = await prisma.telegramPromoMessage.findMany({
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(promos)
  } catch (error) {
    console.error('Failed to fetch promos:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await req.json()
    const { text, photo, isActive } = data

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 })
    }

    const promo = await prisma.telegramPromoMessage.create({
      data: {
        text,
        photo: photo || null,
        isActive: isActive !== undefined ? isActive : true
      }
    })

    return NextResponse.json(promo)
  } catch (error) {
    console.error('Failed to create promo:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await req.json()
    const { id, text, photo, isActive } = data

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const promo = await prisma.telegramPromoMessage.update({
      where: { id },
      data: {
        text: text !== undefined ? text : undefined,
        photo: photo !== undefined ? (photo || null) : undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    })

    return NextResponse.json(promo)
  } catch (error) {
    console.error('Failed to update promo:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    await prisma.telegramPromoMessage.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete promo:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
