import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { HostedBotCommandType } from '@prisma/client'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  const user = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
  if (!user || user.role !== 'OWNER') return null
  return user
}

const VALID_TYPES: HostedBotCommandType[] = ['RECONNECT']

export async function POST(req: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const instanceId = String(body.instanceId || '')
  const type = String(body.type || '').toUpperCase() as HostedBotCommandType

  if (!instanceId) return NextResponse.json({ error: 'instanceId is required' }, { status: 400 })
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'type must be RECONNECT' }, { status: 400 })
  }

  const instance = await prisma.hostedBotInstance.findUnique({ where: { id: instanceId } })
  if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 })

  let payload: string | null = null

  const command = await prisma.hostedBotCommand.create({
    data: {
      instanceId,
      type,
      payload,
      createdById: owner.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: owner.id,
      action: `HOSTED_BOT_COMMAND_${type}`,
      details: JSON.stringify({ instanceId, type, guildId: instance.guildId }),
    },
  })

  return NextResponse.json({ success: true, command })
}

export async function GET(req: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const command = await prisma.hostedBotCommand.findUnique({ where: { id } })
  if (!command) return NextResponse.json({ error: 'Command not found' }, { status: 404 })

  return NextResponse.json({ command })
}
